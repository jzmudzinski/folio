// Live notes primitive — sidecar JSONL feed + compile logic.
//
// Storage:
//   ~/Folio/threads/<topic>/<slug>.html         — the note body, written once at
//                                                  create + once at finalize.
//   ~/Folio/threads/<topic>/<slug>.entries.jsonl — append-only feed (one
//                                                  LiveEntry per line).
//
// Compile rule (server-side at SSE emit AND client-side after receive):
//   For entry X, compiled tag set =
//     X.tags ∪ (Y.tags for every Y where Y.refs.includes(X.id),
//               merged in ts ascending order)
//   - Within a namespace (`ns:value`), last write wins.
//   - Non-namespaced tags accumulate (set semantics).
//   - Refs are direct only (no transitive chain). Z refs Y refs X does not
//     propagate Z's tags onto X; Z must reference X explicitly to do so.
//
// Visibility:
//   An entry is rendered iff its sanitized content_html (trimmed) is
//   non-empty. Empty entries (used by set_pinned for pure tag mutations)
//   still affect compiled tag sets of their refs targets, just don't show
//   in the chronological feed.

import { readFileSync, existsSync, appendFileSync } from "node:fs";
import { ulid } from "ulid";
import { sanitize } from "./sanitize";
import type { LiveEntry, CompiledEntry } from "./types";

/** Max content_html size in bytes, after sanitize. Roughly one screen of
 *  rich HTML. Larger entries should be a regular note, not a feed entry. */
export const MAX_CONTENT_HTML_BYTES = 32 * 1024;

/** Max number of tags on a single entry. Tag explosion is a code smell. */
export const MAX_TAGS_PER_ENTRY = 32;

/** Max number of refs on a single entry. Chain-of-entries should be linear. */
export const MAX_REFS_PER_ENTRY = 16;

/** Derive the sidecar JSONL path from a note's .html path. */
export function entriesPath(notePath: string): string {
  if (!notePath.endsWith(".html")) {
    throw new Error(`entriesPath: expected .html path, got ${notePath}`);
  }
  return notePath.replace(/\.html$/, ".entries.jsonl");
}

/** Time-sortable 10-char id (last 10 of a ulid, lowercased). Collision
 *  resistance is fine at the scale of one note's feed. */
export function newEntryId(): string {
  return ulid().slice(-10).toLowerCase();
}

/**
 * Owner-locked enforcement for live notes (W2). A live note's
 * `owner_device_id` is set at create time to whichever device made it.
 * Only that device may append entries — other devices that have pulled the
 * note via sync see a clear error pointing at the canonical workflow
 * (create your own live note in the same thread).
 *
 * Notes without owner_device_id (pre-W2 or non-live) pass through. The
 * sync migration backfills owner_device_id for existing live notes to the
 * device that ran the migration, preserving local-only behavior.
 */
export function assertCanAppend(note: { owner_device_id: string | null; thread_id: string }): void {
  if (!note.owner_device_id) return; // unowned (non-live or pre-W2) — no gate
  // Late import to avoid a cycle: config → storage → live.
  const { getOrCreateDeviceId } = require("./config") as typeof import("./config");
  const self = getOrCreateDeviceId().id;
  if (note.owner_device_id !== self) {
    throw new Error(
      `This live note belongs to device '${note.owner_device_id}'. ` +
        `Create your own live note in thread '${note.thread_id}' to log here.`
    );
  }
}

/** Read all entries from a JSONL file. Missing file → empty array.
 *  Corrupt lines (JSON parse errors) are skipped, not fatal — protects
 *  against rare concurrent-write interleaving on large entries. */
export function readEntries(jsonlPath: string): LiveEntry[] {
  if (!existsSync(jsonlPath)) return [];
  const raw = readFileSync(jsonlPath, "utf-8");
  const lines = raw.split("\n");
  const out: LiveEntry[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj === "object" && typeof obj.id === "string" && typeof obj.ts === "string") {
        out.push(obj as LiveEntry);
      }
    } catch {
      // Skip corrupt line. Real-world cause: rare concurrent append
      // interleaving when an entry exceeds PIPE_BUF (~4KB) on POSIX.
      // Loss of a single entry is acceptable; the alternative (lockfile)
      // would add coordination overhead for marginal benefit at MVP scale.
    }
  }
  return out;
}

/** Input to append. Mirrors the MCP tool args. */
export interface AppendEntryInput {
  content_html: string;
  tags?: string[];
  refs?: string[];
  importance?: 1 | 2 | 3 | 4 | 5;
  source_ref?: string;
  occurred_at?: string;
}

export interface AppendEntryResult {
  entry: LiveEntry;
  /** From sanitize — agents see this in the ADR-017 event. */
  sanitizer_drops: number;
}

/**
 * Validate input, sanitize content_html, build a LiveEntry, append to the
 * sidecar JSONL. Throws on validation errors (caller maps to MCP error).
 * The caller is responsible for:
 *   - ensuring the note exists and is live + not final
 *   - validating that refs[] target existing entry ids
 *   - updating notes.last_entry_at in db
 *   - emitting the ADR-017 event
 *   - publishing to sse-hub
 */
export function appendEntry(
  jsonlPath: string,
  input: AppendEntryInput,
): AppendEntryResult {
  if (typeof input.content_html !== "string") {
    throw new Error("content_html must be a string");
  }
  if (Array.isArray(input.tags) && input.tags.length > MAX_TAGS_PER_ENTRY) {
    throw new Error(`Too many tags (max ${MAX_TAGS_PER_ENTRY}).`);
  }
  if (Array.isArray(input.refs) && input.refs.length > MAX_REFS_PER_ENTRY) {
    throw new Error(`Too many refs (max ${MAX_REFS_PER_ENTRY}).`);
  }
  if (input.tags && !input.tags.every((t) => typeof t === "string" && t.length > 0 && t.length <= 200)) {
    throw new Error("Each tag must be a non-empty string ≤ 200 chars.");
  }
  if (input.refs && !input.refs.every((r) => typeof r === "string" && /^[a-z0-9]+$/.test(r))) {
    throw new Error("Each ref must be a lowercase alphanumeric entry id.");
  }
  if (input.occurred_at && Number.isNaN(Date.parse(input.occurred_at))) {
    throw new Error(`occurred_at is not a valid ISO timestamp: ${input.occurred_at}`);
  }
  if (input.importance !== undefined && ![1, 2, 3, 4, 5].includes(input.importance)) {
    throw new Error("importance must be one of 1, 2, 3, 4, 5.");
  }

  const { html: cleanHtml, drops } = sanitize(input.content_html);
  if (Buffer.byteLength(cleanHtml, "utf-8") > MAX_CONTENT_HTML_BYTES) {
    throw new Error(`content_html exceeds ${MAX_CONTENT_HTML_BYTES} bytes after sanitize.`);
  }

  const entry: LiveEntry = {
    id: newEntryId(),
    ts: new Date().toISOString(),
    content_html: cleanHtml,
    tags: (input.tags ?? []).slice(),
  };
  if (input.occurred_at) entry.occurred_at = input.occurred_at;
  if (input.refs && input.refs.length > 0) entry.refs = input.refs.slice();
  if (input.importance !== undefined) entry.importance = input.importance;
  if (input.source_ref) entry.source_ref = input.source_ref;

  const line = JSON.stringify(entry) + "\n";
  appendFileSync(jsonlPath, line, "utf-8");

  return { entry, sanitizer_drops: drops };
}

// ───── Compile ────────────────────────────────────────────────────────────

/**
 * Parse a tag string into (namespace, value) or (null, raw) for unnamespaced.
 * Namespace is everything before the first `:`. If multiple colons, only the
 * first splits; the rest is part of the value. Empty namespace ("") is
 * treated as unnamespaced.
 */
export function parseTag(tag: string): { ns: string | null; value: string; raw: string } {
  const idx = tag.indexOf(":");
  if (idx <= 0) return { ns: null, value: tag, raw: tag };
  return { ns: tag.slice(0, idx), value: tag.slice(idx + 1), raw: tag };
}

/**
 * Merge a set of tag strings according to the compile rule:
 *   - Tags with a namespace (`ns:value`): later writes override earlier
 *     writes within the same namespace.
 *   - Tags without a namespace: accumulate as a set.
 * Order matters: pass tags in ts-ascending order so "last write" is correct.
 */
function mergeTags(initial: string[], followups: string[][]): string[] {
  // Track by ns key. Map: ns → most-recent raw tag.
  const nsMap = new Map<string, string>();
  // Track unnamespaced tags as a Set.
  const unNs = new Set<string>();

  const applyOne = (t: string) => {
    const { ns, raw } = parseTag(t);
    if (ns === null) unNs.add(raw);
    else nsMap.set(ns, raw);
  };

  for (const t of initial) applyOne(t);
  for (const group of followups) {
    for (const t of group) applyOne(t);
  }

  return [...nsMap.values(), ...unNs];
}

/**
 * Compile every entry into a CompiledEntry. Pure function: no I/O.
 * Sorts entries by ts ascending for deterministic last-write-wins.
 */
export function compile(entries: LiveEntry[]): CompiledEntry[] {
  // Sort a copy by ts ascending. Stable: equal ts preserves insertion order.
  const sorted = [...entries].sort((a, b) => a.ts.localeCompare(b.ts));

  // Index follow-ups by their refs target.
  const followupsByTarget = new Map<string, LiveEntry[]>();
  for (const e of sorted) {
    if (!e.refs) continue;
    for (const target of e.refs) {
      const arr = followupsByTarget.get(target);
      if (arr) arr.push(e);
      else followupsByTarget.set(target, [e]);
    }
  }

  return sorted.map((entry) => {
    const followups = (followupsByTarget.get(entry.id) ?? []).map((f) => f.tags);
    const compiled_tags = mergeTags(entry.tags, followups);

    let state: string | undefined;
    let pinned = false;
    for (const t of compiled_tags) {
      const { ns, value } = parseTag(t);
      if (ns === "state") state = value;
      else if (ns === "view" && value === "pinned") pinned = true;
    }

    const rendered = entry.content_html.trim().length > 0;

    return {
      ...entry,
      compiled_tags,
      ...(state !== undefined ? { state } : {}),
      pinned,
      rendered,
    };
  });
}

/**
 * Convenience: compile + filter to only rendered entries, preserving order.
 * What the viewer feed wants 99% of the time.
 */
export function compileRendered(entries: LiveEntry[]): CompiledEntry[] {
  return compile(entries).filter((c) => c.rendered);
}

/**
 * Compute the current pinned set (entry ids whose compiled view:* === "pinned").
 * Used by set_pinned to diff target vs current.
 */
export function currentPinnedIds(entries: LiveEntry[]): string[] {
  return compile(entries)
    .filter((c) => c.pinned)
    .map((c) => c.id);
}
