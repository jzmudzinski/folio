// SSE endpoint + entries.css route + concurrent watchers + chrome panel
// injection. Spins up the viewer on an ephemeral port for each test.

import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDb } from "../src/core/db";
import { _resetHubForTests } from "../src/core/sse-hub";

let tmpDir: string;
let server: { stop: () => void; port: number; hostname: string } | null = null;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "folio-live-viewer-"));
  process.env.FOLIO_HOME = tmpDir;
  const { init } = await import("../src/cli/commands/init");
  await init();
  const cfgPath = join(tmpDir, "folio.config.json");
  const parsed = JSON.parse(readFileSync(cfgPath, "utf-8"));
  parsed.viewer_port = 0;
  writeFileSync(cfgPath, JSON.stringify(parsed));
  const { startServer } = await import("../src/viewer/server");
  server = (await startServer()) as any;
});

afterEach(() => {
  try { server?.stop(); } catch {}
  server = null;
  _resetHubForTests();
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function callTool(name: string, args: Record<string, unknown> = {}) {
  const { buildServer } = await import("../src/mcp/server");
  const mcp = await buildServer();
  const anySvr = mcp as any;
  return await anySvr._requestHandlers.get("tools/call")({ method: "tools/call", params: { name, arguments: args } });
}

async function makeLiveWithEntries(n: number): Promise<{ id: string; entries: string[] }> {
  const r = await callTool("create", { type: "journal", title: "L", body_html: "", live: true });
  const id = JSON.parse(r.content[0].text).id;
  const entries: string[] = [];
  for (let i = 0; i < n; i++) {
    const er = await callTool("append_entry", { note_id: id, content_html: `<p>entry ${i}</p>`, tags: [`idx:${i}`] });
    entries.push(JSON.parse(er.content[0].text).entry_id);
  }
  return { id, entries };
}

// ───── /entries.css ──────────────────────────────────────────────────────

test("GET /entries.css returns text/css with cache headers", async () => {
  const res = await fetch(`http://${server!.hostname}:${server!.port}/entries.css`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/css");
  expect(res.headers.get("cache-control")).toContain("max-age=300");
  const body = await res.text();
  expect(body).toContain(".entry");
  expect(body).toContain(".entry.pinned");
});

// ───── SSE endpoint guard rails ──────────────────────────────────────────

test("/n/:id/stream 404 when note doesn't exist", async () => {
  const res = await fetch(`http://${server!.hostname}:${server!.port}/n/00000000000000000000000000/stream`);
  expect(res.status).toBe(404);
});

test("/n/:id/stream 404 when note isn't streamable (snippet — not live, not iteration)", async () => {
  const r = await callTool("create", { type: "snippet", title: "X", body_html: "<p>x</p>" });
  const id = JSON.parse(r.content[0].text).id;
  const res = await fetch(`http://${server!.hostname}:${server!.port}/n/${id}/stream`);
  expect(res.status).toBe(404);
  // Pre-v0.20.2 message was "not a live note". v0.20.2 widened the gate to
  // also accept iteration notes, so the message reflects both rejected cases.
  expect(await res.text()).toContain("not streamable");
});

test("/n/:id/stream 404 when note is finalized", async () => {
  const { id } = await makeLiveWithEntries(1);
  await callTool("finalize", { id });
  const res = await fetch(`http://${server!.hostname}:${server!.port}/n/${id}/stream`);
  expect(res.status).toBe(404);
});

// ───── SSE backlog + live updates ────────────────────────────────────────

/**
 * Read SSE frames from a stream into an array, stopping after `n` frames
 * or `timeout` ms. Returns parsed entries.
 */
async function readNFrames(url: string, n: number, timeoutMs = 1500): Promise<any[]> {
  const ctl = new AbortController();
  const res = await fetch(url, { signal: ctl.signal, headers: { Accept: "text/event-stream" } });
  if (!res.body) throw new Error("no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";
  const out: any[] = [];
  const deadline = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    while (out.length < n) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const dataLines = frame.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
        if (dataLines.length === 0) continue;
        try { out.push(JSON.parse(dataLines.join("\n"))); } catch { /* ignore */ }
        if (out.length >= n) break;
      }
    }
  } catch {
    /* abort signaled */
  } finally {
    clearTimeout(deadline);
    try { ctl.abort(); } catch {}
  }
  return out;
}

test("/n/:id/stream emits initial backlog as SSE frames", async () => {
  const { id } = await makeLiveWithEntries(3);
  const url = `http://${server!.hostname}:${server!.port}/n/${id}/stream`;
  const got = await readNFrames(url, 3);
  expect(got.length).toBe(3);
  expect(got[0].content_html).toContain("entry 0");
  expect(got[2].content_html).toContain("entry 2");
});

test("/n/:id/stream emits new entries appended after subscribe", async () => {
  const { id } = await makeLiveWithEntries(1);
  const url = `http://${server!.hostname}:${server!.port}/n/${id}/stream`;

  // Start reading; expect 1 backlog + 1 fresh.
  const collect: any[] = [];
  const ctl = new AbortController();
  const reader = (async () => {
    const res = await fetch(url, { signal: ctl.signal, headers: { Accept: "text/event-stream" } });
    if (!res.body) return;
    const r = res.body.getReader();
    const dec = new TextDecoder("utf-8");
    let buf = "";
    while (collect.length < 2) {
      const { done, value } = await r.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const dataLines = frame.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
        if (dataLines.length === 0) continue;
        try { collect.push(JSON.parse(dataLines.join("\n"))); } catch { /* ignore */ }
        if (collect.length >= 2) break;
      }
    }
  })();

  // Wait briefly so backlog flushes + subscribe is registered.
  await new Promise((res) => setTimeout(res, 100));
  await callTool("append_entry", { note_id: id, content_html: "<p>after subscribe</p>" });

  await Promise.race([
    reader,
    new Promise((res) => setTimeout(res, 1500)),
  ]);
  try { ctl.abort(); } catch {}

  expect(collect.length).toBe(2);
  expect(collect[1].content_html).toContain("after subscribe");
});

// ───── Chrome panel injection on /n/:id ─────────────────────────────────

test("/n/:id renders live panel + chrome JS only when note.live && !is_final", async () => {
  const { id } = await makeLiveWithEntries(1);
  const url = `http://${server!.hostname}:${server!.port}/n/${id}`;
  const res = await fetch(url);
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain("live-panel");
  expect(html).toContain("live-panel-iframe");
  expect(html).toContain("__folioLiveNoteId");
  expect(html).toContain("note-shell has-live");
});

test("/n/:id does NOT render live panel on a regular note", async () => {
  const r = await callTool("create", { type: "snippet", title: "Static", body_html: "<p>plain</p>" });
  const id = JSON.parse(r.content[0].text).id;
  const res = await fetch(`http://${server!.hostname}:${server!.port}/n/${id}`);
  const html = await res.text();
  // Check for the actual rendered <iframe class="live-panel-iframe">, not just
  // the CSS rule definition (.live-panel-iframe { ... }) that's in VIEWER_CSS.
  expect(html).not.toContain('<iframe class="live-panel-iframe"');
  expect(html).not.toContain("__folioLiveNoteId");
  expect(html).not.toContain("note-shell has-live");
});

test("/n/:id stops rendering live panel after finalize", async () => {
  const { id } = await makeLiveWithEntries(1);
  await callTool("finalize", { id });
  const res = await fetch(`http://${server!.hostname}:${server!.port}/n/${id}`);
  const html = await res.text();
  expect(html).not.toContain('<iframe class="live-panel-iframe"');
  expect(html).not.toContain("__folioLiveNoteId");
  // But compiled entries should now be in the body iframe (served at /raw/)
  const raw = await fetch(`http://${server!.hostname}:${server!.port}/raw/${id}`);
  expect(await raw.text()).toContain("entry 0");
});

test("two concurrent subscribers both receive new entries", async () => {
  const { id } = await makeLiveWithEntries(0);
  const url = `http://${server!.hostname}:${server!.port}/n/${id}/stream`;

  function start(): { collect: any[]; abort: () => void; done: Promise<void> } {
    const collect: any[] = [];
    const ctl = new AbortController();
    const done = (async () => {
      const res = await fetch(url, { signal: ctl.signal, headers: { Accept: "text/event-stream" } });
      if (!res.body) return;
      const r = res.body.getReader();
      const dec = new TextDecoder("utf-8");
      let buf = "";
      while (collect.length < 1) {
        const { done, value } = await r.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const dataLines = frame.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
          if (dataLines.length === 0) continue;
          try { collect.push(JSON.parse(dataLines.join("\n"))); } catch { /* ignore */ }
          if (collect.length >= 1) break;
        }
      }
    })();
    return { collect, abort: () => { try { ctl.abort(); } catch {} }, done };
  }

  const a = start();
  const b = start();

  await new Promise((res) => setTimeout(res, 100));
  await callTool("append_entry", { note_id: id, content_html: "<p>broadcast</p>" });

  await Promise.race([
    Promise.all([a.done, b.done]),
    new Promise((res) => setTimeout(res, 1500)),
  ]);
  a.abort();
  b.abort();

  expect(a.collect.length).toBe(1);
  expect(b.collect.length).toBe(1);
  expect(a.collect[0].content_html).toContain("broadcast");
  expect(b.collect[0].content_html).toContain("broadcast");
});
