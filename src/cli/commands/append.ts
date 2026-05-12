// `folio append <id> --content @file.html --tags state:open,project:x`
//
// User-facing wrapper around append_entry's underlying machinery. Mirrors
// the MCP tool's semantics (live + !final, refs validation, sanitize,
// jsonl append, db.last_entry_at update, event log) so an append from
// CLI and from agent are observationally identical.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getNoteMeta, updateLastEntryAt } from "../../core/storage";
import { folioRoot } from "../../core/config";
import { logEvent } from "../../core/db";
import { entriesPath, readEntries, appendEntry } from "../../core/live";
import { c, out, err, json } from "../io";

export interface AppendOpts {
  id: string;
  contentFile?: string;
  contentInline?: string;
  tags?: string[];
  refs?: string[];
  importance?: number;
  sourceRef?: string;
  occurredAt?: string;
  jsonOut?: boolean;
}

export async function appendCmd(opts: AppendOpts): Promise<number> {
  if (!opts.id) {
    err(c.err("✗ note id required\n"));
    return 3;
  }
  const note = getNoteMeta(opts.id);
  if (!note) {
    err(c.err(`✗ Note not found: ${opts.id}\n`));
    return 4;
  }
  if (!note.live) {
    err(c.err(`✗ Note ${opts.id} is not a live note (create with --live).\n`));
    return 5;
  }
  if (note.is_final) {
    err(c.err(`✗ Note ${opts.id} is final; cannot append.\n`));
    return 6;
  }

  // Resolve content_html: --content @file, --content "inline", or stdin.
  let content_html = "";
  if (opts.contentFile) {
    if (!existsSync(opts.contentFile)) {
      err(c.err(`✗ file not found: ${opts.contentFile}\n`));
      return 4;
    }
    content_html = readFileSync(opts.contentFile, "utf-8");
  } else if (opts.contentInline !== undefined) {
    content_html = opts.contentInline;
  } else if (!process.stdin.isTTY) {
    const chunks: Uint8Array[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Uint8Array);
    content_html = Buffer.concat(chunks).toString("utf-8");
  } else {
    err(c.err("✗ no content — pass --content @file, --content 'string', or pipe stdin\n"));
    return 3;
  }

  // Validate refs against existing entry ids.
  const jsonl = entriesPath(join(folioRoot(), note.path));
  if (opts.refs && opts.refs.length > 0) {
    const existing = new Set(readEntries(jsonl).map((e) => e.id));
    const bad = opts.refs.filter((r) => !existing.has(r));
    if (bad.length > 0) {
      err(c.err(`✗ refs reference unknown entry id(s): ${bad.join(", ")}\n`));
      return 7;
    }
  }

  let result;
  try {
    result = appendEntry(jsonl, {
      content_html,
      tags: opts.tags,
      refs: opts.refs,
      importance: opts.importance as 1 | 2 | 3 | 4 | 5 | undefined,
      source_ref: opts.sourceRef,
      occurred_at: opts.occurredAt,
    });
  } catch (e: any) {
    err(c.err(`✗ ${e?.message ?? e}\n`));
    return 8;
  }

  updateLastEntryAt(opts.id, result.entry.ts);
  // Fast-path SSE for the in-process hub. If this CLI invocation runs in a
  // different process from `folio serve`, the serve-side fs.watch picks up
  // the append a moment later. publish() here is a no-op when there are
  // no in-process subscribers.
  const { publish } = await import("../../core/sse-hub");
  publish(opts.id, jsonl);
  logEvent(
    "live_entry_appended",
    {
      entry_id: result.entry.id,
      tags_count: result.entry.tags.length,
      refs_count: result.entry.refs?.length ?? 0,
      content_size_bytes: Buffer.byteLength(result.entry.content_html, "utf-8"),
      rendered: result.entry.content_html.trim().length > 0,
      sanitizer_drops: result.sanitizer_drops,
      via: "cli",
    },
    opts.id,
    note.thread_id,
  );

  if (opts.jsonOut) {
    json({
      entry_id: result.entry.id,
      ts: result.entry.ts,
      note_id: opts.id,
    });
  } else {
    out(c.ok("✓") + ` Appended entry ${c.bold(result.entry.id)} to ${note.title}`);
    if (result.entry.tags.length > 0) out(`  ${c.dim("tags ")} ${result.entry.tags.join(", ")}`);
  }
  return 0;
}
