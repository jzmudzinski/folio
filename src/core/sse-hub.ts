// In-process pub/sub for live note SSE streams.
//
// Each live note that has at least one subscriber gets a single fs.watch
// watching its .entries.jsonl plus a byte-offset tracker. When the file
// grows (any append, regardless of source — MCP tool, CLI, or future
// remote), the hub reads from the last offset to the new file size,
// splits on newlines, parses each line as a LiveEntry, and fans out to
// all subscribers for that note.
//
// Direct publish() is also exposed so the MCP/CLI append paths can fire
// immediately without waiting for fs.watch — useful on macOS where
// fs.watch coalesces or drops events under load. The dual path is safe:
// if both fire for the same append, the offset check prevents duplicate
// emission (the file content past the recorded offset is identical).
//
// Polling fallback (v0.19.2): fs.watch is in-process only. When two
// processes share a note's JSONL — e.g. MCP server hosts an agent
// running `wait_for_pick` while the viewer process appends the pick on
// user click — the writer's publish() doesn't reach the other process's
// channels Map. The only bridge is fs.watch, and on macOS it can lag /
// coalesce / silently drop. So every active channel runs a 500ms poll
// that calls drainAndEmit. It's cheap (one statSync per active channel),
// guarantees cross-process delivery within ~500ms, and is a no-op when
// fs.watch already drained the bytes (offset check prevents duplicates).

import { existsSync, statSync, readFileSync, watch, type FSWatcher } from "node:fs";
import type { LiveEntry } from "./types";

export type EntryListener = (entry: LiveEntry) => void;

interface Channel {
  jsonlPath: string;
  watcher: FSWatcher | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  /** Byte offset already consumed from the file. */
  offset: number;
  listeners: Set<EntryListener>;
}

const channels = new Map<string, Channel>();

const POLL_INTERVAL_MS = 500;

function openChannel(noteId: string, jsonlPath: string): Channel {
  const existing = channels.get(noteId);
  if (existing) return existing;

  const ch: Channel = { jsonlPath, watcher: null, pollTimer: null, offset: 0, listeners: new Set() };
  // Seed offset at the current file size so we don't replay the entire
  // backlog when the first subscriber arrives — the caller does its own
  // backlog read separately (so it sees a deterministic point-in-time
  // snapshot before live events start arriving).
  if (existsSync(jsonlPath)) {
    ch.offset = statSync(jsonlPath).size;
  }
  channels.set(noteId, ch);
  return ch;
}

/**
 * Read whatever's new in the file past `ch.offset` and emit each parsed
 * entry to every listener. Updates `ch.offset` to the new file size.
 * Safe to call from both fs.watch fire and direct publish() — repeated
 * calls with no new bytes are no-ops.
 */
function drainAndEmit(ch: Channel): void {
  if (!existsSync(ch.jsonlPath)) return;
  const size = statSync(ch.jsonlPath).size;
  if (size <= ch.offset) return;

  // Read tail. Slice from offset, parse line-by-line.
  const buf = readFileSync(ch.jsonlPath);
  const newBytes = buf.subarray(ch.offset, size);
  ch.offset = size;

  const text = newBytes.toString("utf-8");
  // The previous chunk may have ended mid-line on a partial write, but
  // since we only advance offset to file size at end of read, and writes
  // are full-line atomic at fs level, this is rare. If it happens, the
  // corrupt line gets skipped by the JSON.parse try/catch.
  const lines = text.split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    let entry: LiveEntry | null = null;
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj === "object" && typeof obj.id === "string" && typeof obj.ts === "string") {
        entry = obj as LiveEntry;
      }
    } catch {
      // Skip corrupt line (rare; see live.ts readEntries comment).
    }
    if (!entry) continue;
    for (const fn of ch.listeners) {
      try { fn(entry); } catch { /* listener error should not crash hub */ }
    }
  }
}

function ensureWatcher(ch: Channel): void {
  if (ch.watcher) return;
  try {
    // fs.watch fires on rename + change. We only care about change/append.
    // Use { persistent: false } so the watcher doesn't keep the process
    // alive after all subscribers are gone — closing the watcher on
    // unsubscribe is the canonical cleanup path; this is belt-and-braces.
    ch.watcher = watch(ch.jsonlPath, { persistent: false }, () => {
      drainAndEmit(ch);
    });
  } catch {
    // File may not exist yet (live note created but no entries appended).
    // The first publish() will create it; we'll start the watcher then.
    ch.watcher = null;
  }
}

function ensurePollTimer(ch: Channel): void {
  if (ch.pollTimer) return;
  // setInterval.unref() so a long-poll subscription never keeps the
  // process alive after all subscribers explicitly unsubscribed. With
  // listeners present the channel is healthy; without them, this is
  // already cleaned up via channels.delete() in the unsubscribe path.
  const t = setInterval(() => drainAndEmit(ch), POLL_INTERVAL_MS);
  if (typeof t.unref === "function") t.unref();
  ch.pollTimer = t;
}

/** Subscribe to new entries on a note. Returns unsubscribe function. */
export function subscribe(
  noteId: string,
  jsonlPath: string,
  onEntry: EntryListener,
): () => void {
  const ch = openChannel(noteId, jsonlPath);
  ch.listeners.add(onEntry);
  ensureWatcher(ch);
  ensurePollTimer(ch);

  return () => {
    ch.listeners.delete(onEntry);
    if (ch.listeners.size === 0) {
      // Last subscriber gone — tear down the watcher + poll timer and
      // forget the channel so a future subscribe starts with a fresh
      // offset (re-seeded at current file size, no backlog replay).
      try { ch.watcher?.close(); } catch { /* ignore */ }
      if (ch.pollTimer) clearInterval(ch.pollTimer);
      channels.delete(noteId);
    }
  };
}

/**
 * Notify the hub that the jsonl just grew (called from MCP/CLI append
 * paths). Reads new bytes immediately and fans out to subscribers. This
 * is the fast path; fs.watch is the fallback for out-of-process writers.
 */
export function publish(noteId: string, jsonlPath: string): void {
  const ch = channels.get(noteId);
  if (!ch) return; // No subscribers — nothing to do.
  // If the file just appeared, the watcher may not have started yet.
  ensureWatcher(ch);
  drainAndEmit(ch);
}

/** Test helper: clear all channels (call between tests if needed). */
export function _resetHubForTests(): void {
  for (const ch of channels.values()) {
    try { ch.watcher?.close(); } catch { /* ignore */ }
    if (ch.pollTimer) clearInterval(ch.pollTimer);
  }
  channels.clear();
}
