/**
 * folio-event-watcher — OpenClaw hook (v0.21.0+).
 *
 * Surfaces new Folio events into the agent's context on every user turn.
 * Polling-on-message pattern from docs/openclaw-integration.md (Option A).
 *
 * Event types this hook is interested in (edit MATCH_TAGS to tune):
 *   - `kind:pick`    — user picked an iteration variant
 *   - `kind:variant` — agent proposed a new iteration round
 *   - `state:done`   — live-note todo marked done
 *   - `view:pinned`  — entry pinned to "Worth noticing" rail
 *
 * Cursor persistence: ~/.openclaw/state/folio-cursors-<sessionKey>.json
 *   Shape: { [absoluteJsonlPath]: <lastSeenEntryId> }
 *
 * The handler is bounded — completes in tens of milliseconds for normal
 * filesystem sizes. No daemons, no sockets, no shell-outs.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const MATCH_TAGS = ["kind:pick", "kind:variant", "state:done", "view:pinned"];
const MAX_EVENTS_PER_TURN = 20;
const FIRST_TIME_LOOKBACK = 5; // when cursor missing for a file, surface only the last N entries

interface LiveEntry {
  id: string;
  ts: string;
  content_html: string;
  plain?: string;
  tags?: string[];
  refs?: string[];
  source_ref?: string;
}

interface CursorState {
  // absoluteJsonlPath → lastSeenEntryId
  [path: string]: string;
}

interface OpenClawEvent {
  type: string;
  action?: string;
  sessionKey?: string;
  timestamp?: string;
  messages: string[];
  context?: Record<string, unknown>;
}

function folioHome(): string {
  return process.env.FOLIO_HOME?.trim() || join(homedir(), "Folio");
}

function openClawState(): string {
  return process.env.OPENCLAW_STATE_DIR?.trim() || join(homedir(), ".openclaw", "state");
}

function cursorFile(sessionKey: string): string {
  // Sanitize sessionKey for filesystem use — sessionKey can contain colons,
  // slashes, anything. Hash-like substitution keeps each session distinct.
  const safe = sessionKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  return join(openClawState(), `folio-cursors-${safe || "default"}.json`);
}

function readCursors(path: string): CursorState {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as CursorState;
  } catch {
    return {};
  }
}

function writeCursors(path: string, cursors: CursorState): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o755 });
  writeFileSync(path, JSON.stringify(cursors, null, 2), { mode: 0o600 });
}

function listJsonl(threadsDir: string): string[] {
  if (!existsSync(threadsDir)) return [];
  const out: string[] = [];
  for (const threadName of readdirSync(threadsDir)) {
    const threadPath = join(threadsDir, threadName);
    let stat;
    try { stat = statSync(threadPath); } catch { continue; }
    if (!stat.isDirectory()) continue;
    let entries;
    try { entries = readdirSync(threadPath); } catch { continue; }
    for (const f of entries) {
      if (f.endsWith(".entries.jsonl")) out.push(join(threadPath, f));
    }
  }
  return out;
}

function readEntries(jsonl: string): LiveEntry[] {
  if (!existsSync(jsonl)) return [];
  let raw: string;
  try { raw = readFileSync(jsonl, "utf-8"); } catch { return []; }
  const out: LiveEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj === "object" && typeof obj.id === "string") out.push(obj as LiveEntry);
    } catch {
      // Corrupt line — skip. Same posture as Folio's own readEntries().
    }
  }
  return out;
}

function matchesAny(tags: string[] | undefined, predicates: string[]): boolean {
  if (!tags) return false;
  for (const p of predicates) {
    if (tags.includes(p)) return true;
  }
  return false;
}

function summarize(entry: LiveEntry, noteTitle: string): string {
  const tags = entry.tags ?? [];
  if (tags.includes("kind:variant")) {
    const round = tags.find((t) => t.startsWith("round:"))?.slice("round:".length) ?? "?";
    const label = entry.source_ref ? ` (${entry.source_ref})` : "";
    return `[iteration] ${noteTitle} — round ${round} variant proposed${label}`;
  }
  if (tags.includes("kind:pick")) {
    const round = tags.find((t) => t.startsWith("round:"))?.slice("round:".length) ?? "?";
    const winner = entry.refs?.[0] ?? "(unknown)";
    return `[iteration] ${noteTitle} — round ${round} picked, winner=${winner}`;
  }
  if (tags.includes("state:done")) {
    return `[done] ${noteTitle} — entry marked done`;
  }
  if (tags.includes("view:pinned")) {
    return `[pinned] ${noteTitle} — entry pinned to "Worth noticing"`;
  }
  return `[event] ${noteTitle}`;
}

function noteTitleFromJsonlPath(jsonl: string): string {
  // Threads dir layout: <FOLIO_HOME>/threads/<thread>/<slug>.entries.jsonl
  // We don't have the title without a sqlite read; thread/slug is a fine
  // human-readable surrogate that doesn't need the FTS index loaded.
  const parts = jsonl.split("/");
  const slug = parts[parts.length - 1]!.replace(/\.entries\.jsonl$/, "");
  const thread = parts[parts.length - 2] ?? "";
  return thread === slug ? slug : `${thread}/${slug}`;
}

const handler = async (event: OpenClawEvent): Promise<void> => {
  // Fire only on user-typed messages. Other event types pass through.
  if (event.type !== "message" || event.action !== "received") return;

  const sessionKey = event.sessionKey ?? "default";
  const cursorPath = cursorFile(sessionKey);
  const cursors = readCursors(cursorPath);

  const threadsDir = join(folioHome(), "threads");
  const jsonls = listJsonl(threadsDir);
  if (jsonls.length === 0) return;

  const collected: string[] = [];
  let firstRun = Object.keys(cursors).length === 0;

  for (const jsonl of jsonls) {
    const entries = readEntries(jsonl);
    if (entries.length === 0) continue;

    const lastSeen = cursors[jsonl] ?? "";
    let startIdx: number;
    if (!lastSeen && firstRun) {
      // First-ever invocation: bound the backfill so a fresh install on a
      // busy machine doesn't dump hundreds of historical entries.
      startIdx = Math.max(0, entries.length - FIRST_TIME_LOOKBACK);
    } else if (!lastSeen) {
      // Per-file unknown cursor (new file since last run) — show everything
      // since file appeared.
      startIdx = 0;
    } else {
      const idx = entries.findIndex((e) => e.id === lastSeen);
      startIdx = idx >= 0 ? idx + 1 : 0;
    }

    const noteTitle = noteTitleFromJsonlPath(jsonl);
    for (let i = startIdx; i < entries.length; i++) {
      const e = entries[i]!;
      if (!matchesAny(e.tags, MATCH_TAGS)) continue;
      collected.push(summarize(e, noteTitle));
      if (collected.length >= MAX_EVENTS_PER_TURN) break;
    }

    // Always advance the cursor — even if no matching events, so we don't
    // re-evaluate the same lines next turn.
    cursors[jsonl] = entries[entries.length - 1]!.id;
    if (collected.length >= MAX_EVENTS_PER_TURN) break;
  }

  writeCursors(cursorPath, cursors);

  if (collected.length > 0) {
    const header = collected.length === 1
      ? "Folio event since your last turn:"
      : `${collected.length} Folio events since your last turn:`;
    event.messages.push([header, ...collected.map((c) => `  • ${c}`)].join("\n"));
  }
};

export default handler;
