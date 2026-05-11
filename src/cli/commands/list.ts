import { listNotes } from "../../core/storage";
import { c, out, json } from "../io";
import type { NoteType } from "../../core/types";

interface ListOpts {
  type?: string;
  thread?: string;
  isFinal?: boolean;
  limit?: number;
  jsonOut?: boolean;
}

function fmtAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export async function list(opts: ListOpts): Promise<number> {
  const rows = listNotes({
    type: opts.type as NoteType | undefined,
    thread_id: opts.thread,
    is_final: opts.isFinal,
    limit: opts.limit ?? 50,
  });
  if (opts.jsonOut) {
    json(rows);
    return 0;
  }
  if (rows.length === 0) {
    out(c.dim("(no notes)"));
    return 0;
  }
  for (const n of rows) {
    const status = n.is_final ? c.ok("★") : c.dim("·");
    const typeC =
      n.type === "research" ? c.info(n.type) :
      n.type === "comparison" ? c.magenta(n.type) :
      n.type === "technical" ? c.warn(n.type) :
      c.dim(n.type);
    out(
      `${status} ${c.bold(n.title.padEnd(50).slice(0, 50))} ${typeC.padEnd(12)} ${c.dim(n.thread_id.padEnd(24).slice(0, 24))} ${c.dim(fmtAgo(n.created))}`
    );
  }
  out("");
  out(c.dim(`${rows.length} note${rows.length === 1 ? "" : "s"}`));
  return 0;
}
