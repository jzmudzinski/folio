// `folio tail <id>` — connects to /n/:id/stream via fetch + ReadableStream
// and prints each new entry as it arrives. For debugging a live note
// without opening the viewer.
//
// Exits on SIGINT (Ctrl-C) cleanly. The remote stream stays open until
// the process is killed; folio.serve must be running for this to work
// (otherwise an immediate connection refusal).

import { loadConfig, viewerLocalBaseUrl } from "../../core/config";
import { c, out, err } from "../io";

export interface TailOpts {
  id: string;
  /** Print JSON-encoded entries (one per line) instead of pretty output. */
  jsonOut?: boolean;
}

export async function tailCmd(opts: TailOpts): Promise<number> {
  if (!opts.id) {
    err(c.err("✗ note id required\n"));
    return 3;
  }
  const cfg = await loadConfig();
  const url = `${viewerLocalBaseUrl(cfg)}/n/${opts.id}/stream`;

  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "text/event-stream" } });
  } catch (e: any) {
    err(c.err(`✗ Could not connect to ${url}: ${e?.message ?? e}\n`));
    err(c.dim("  Is `folio serve` running?\n"));
    return 4;
  }
  if (!res.ok) {
    err(c.err(`✗ HTTP ${res.status} from ${url}\n`));
    if (res.status === 404) err(c.dim("  Note not found, or not live, or already finalized.\n"));
    return 4;
  }
  if (!res.body) {
    err(c.err("✗ Empty response body — server may not support SSE here.\n"));
    return 4;
  }

  out(c.dim(`tailing ${url} (Ctrl-C to stop)\n`));

  // Minimal SSE parser: lines starting "data:" are payloads, double-newline
  // is the frame delimiter. We assume each frame's data is a single JSON
  // line (live-panel matches this contract).
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";

  const onSig = () => { try { reader.cancel(); } catch {} };
  process.once("SIGINT", onSig);
  process.once("SIGTERM", onSig);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // Parse frame-by-frame. Frames are separated by "\n\n".
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const dataLines = frame.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
        if (dataLines.length === 0) continue;
        const payload = dataLines.join("\n");
        if (opts.jsonOut) {
          out(payload);
        } else {
          printEntry(payload);
        }
      }
    }
  } finally {
    process.off("SIGINT", onSig);
    process.off("SIGTERM", onSig);
  }
  return 0;
}

function printEntry(payload: string): void {
  let obj: any;
  try { obj = JSON.parse(payload); } catch { out(c.dim(payload)); return; }
  const ts = obj.ts ?? "?";
  const id = obj.id ?? "?";
  const tags = Array.isArray(obj.tags) && obj.tags.length > 0 ? `  ${c.dim("tags")} ${obj.tags.join(", ")}` : "";
  out(`${c.dim(ts)}  ${c.cyan(id)}${tags}`);
  if (obj.content_html && obj.content_html.trim()) {
    // Strip tags for terminal readability.
    const text = String(obj.content_html).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    if (text) out(`  ${text}`);
  }
}
