import { searchNotes } from "../../core/storage";
import { c, out, json } from "../io";
import type { NoteType } from "../../core/types";

interface SearchOpts {
  query: string;
  type?: string;
  limit?: number;
  jsonOut?: boolean;
}

function stripTags(s: string): string {
  return s.replace(/<\/?mark>/g, "");
}

function highlight(s: string): string {
  // Map <mark>..</mark> to ANSI inverse (terminal-only) for non-json output
  return s.replace(/<mark>([\s\S]*?)<\/mark>/g, "\x1b[7m$1\x1b[27m");
}

export async function search(opts: SearchOpts): Promise<number> {
  if (!opts.query?.trim()) {
    process.stderr.write(c.err("✗ empty query\n"));
    return 3;
  }
  const hits = searchNotes({
    query: opts.query,
    type: opts.type as NoteType | undefined,
    limit: opts.limit ?? 20,
  });
  if (opts.jsonOut) {
    json(hits.map((h) => ({ ...h, snippet: stripTags(h.snippet) })));
    return 0;
  }
  if (hits.length === 0) {
    out(c.dim(`(no results for "${opts.query}")`));
    return 0;
  }
  out(c.dim(`${hits.length} result${hits.length === 1 ? "" : "s"} for "${opts.query}"`));
  out("");
  for (const h of hits) {
    out(`${c.bold(h.title)} ${c.dim(`★ ${(-h.score).toFixed(2)}`)}`);
    out(`  ${c.dim(h.type + " · " + h.thread_id)}`);
    out(`  ${highlight(h.snippet)}`);
    out("");
  }
  return 0;
}
