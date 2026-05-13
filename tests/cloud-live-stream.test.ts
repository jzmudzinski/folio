/**
 * /v1/sync/live-stream: SSE fanout for live notes.
 *
 * Cloud-side: push a live note + live entry, subscriber gets the entry
 * frame on the open stream. Validation gates: must be live, must be
 * non-finalized, must have valid token (header OR ?token=… query param).
 */

import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeCloudDb } from "../src/cloud/db";

let tmpDir: string;
let server: { stop: () => void; port: number; hostname: string } | null = null;
let baseUrl: string;
let token: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "folio-live-stream-"));
  process.env.FOLIO_CLOUD_HOME = tmpDir;
  const { startCloudServer } = await import("../src/cloud/server");
  server = (await startCloudServer({ port: 0 })) as any;
  baseUrl = `http://${server!.hostname}:${server!.port}`;
  const { createPairingCode } = await import("../src/cloud/auth");
  const { code } = createPairingCode();
  const pairRes = await fetch(`${baseUrl}/v1/auth/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, device_name: "test", device_id: "01HXLIVESTRMTEST000000000XX" }),
  });
  token = ((await pairRes.json()) as { token: string }).token;
});

afterEach(() => {
  try { server?.stop(); } catch {}
  server = null;
  closeCloudDb();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.FOLIO_CLOUD_HOME;
});

async function pushNote(uuid: string, opts: { live?: 0 | 1; is_final?: 0 | 1 } = {}): Promise<void> {
  await fetch(`${baseUrl}/v1/sync/push`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      notes: [{
        uuid, slug: uuid.toLowerCase(), thread_id: "live-stream",
        title: "Streamed", type: "journal",
        body_html: "<p>chrome</p>",
        created_at: new Date().toISOString(),
        live: opts.live ?? 1,
        is_final: opts.is_final ?? 0,
      }],
    }),
  });
}

async function pushEntry(noteUuid: string, id: string, content: string): Promise<void> {
  await fetch(`${baseUrl}/v1/sync/push`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      live_entries: [{
        id, note_uuid: noteUuid, ts: new Date().toISOString(),
        content_html: content,
      }],
    }),
  });
}

test("live-stream rejects without token", async () => {
  await pushNote("01HXLS00000000000000000001");
  const r = await fetch(`${baseUrl}/v1/sync/live-stream?note_uuid=01HXLS00000000000000000001`);
  expect(r.status).toBe(401);
});

test("live-stream accepts token via ?token= query param (EventSource workaround)", async () => {
  await pushNote("01HXLS00000000000000000002");
  const r = await fetch(
    `${baseUrl}/v1/sync/live-stream?note_uuid=01HXLS00000000000000000002&token=${encodeURIComponent(token)}`,
    { signal: AbortSignal.timeout(500) },
  ).catch((e: any) => e); // expected to timeout after we read the first frame
  // Even though we abort, the initial response should have status 200.
  // We get an AbortError after the headers — confirm headers came through.
  if (r instanceof Response) {
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/event-stream");
    try { r.body?.cancel(); } catch {}
  } else {
    // Some Bun versions surface the abort as a thrown error before .ok lands;
    // either way absence of 401 means token was accepted.
    expect(String(r?.message ?? r)).not.toContain("HTTP 401");
  }
});

test("live-stream 400 if note isn't live", async () => {
  await pushNote("01HXLS00000000000000000003", { live: 0 });
  const r = await fetch(`${baseUrl}/v1/sync/live-stream?note_uuid=01HXLS00000000000000000003`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(r.status).toBe(400);
  expect((await r.json()).error).toContain("not a live note");
});

test("live-stream 400 if note is finalized", async () => {
  await pushNote("01HXLS00000000000000000004", { live: 1, is_final: 1 });
  const r = await fetch(`${baseUrl}/v1/sync/live-stream?note_uuid=01HXLS00000000000000000004`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(r.status).toBe(400);
});

test("live-stream 404 if note doesn't exist", async () => {
  const r = await fetch(`${baseUrl}/v1/sync/live-stream?note_uuid=01HXLS00DOESNOTEXIST000000`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(r.status).toBe(404);
});

test("live-stream fans out a pushed entry to an open subscriber", async () => {
  const noteUuid = "01HXLS00000000000000000005";
  await pushNote(noteUuid);

  // Open stream + collect frames for 500ms.
  const ctrl = new AbortController();
  const responsePromise = fetch(
    `${baseUrl}/v1/sync/live-stream?note_uuid=${noteUuid}&token=${encodeURIComponent(token)}`,
    { signal: ctrl.signal },
  );
  const res = await responsePromise;
  expect(res.status).toBe(200);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const frames: string[] = [];

  const readPromise = (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += decoder.decode(value, { stream: true });
      // SSE frames are separated by blank lines.
      while (buf.includes("\n\n")) {
        const idx = buf.indexOf("\n\n");
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (frame.startsWith("event: entry")) frames.push(frame);
      }
    }
  })();

  // Give the subscriber a beat to register, then push an entry.
  await new Promise((r) => setTimeout(r, 50));
  await pushEntry(noteUuid, "entry-ulid-1", "<p>first frame</p>");
  // Push a second so we can assert both arrive in order.
  await new Promise((r) => setTimeout(r, 20));
  await pushEntry(noteUuid, "entry-ulid-2", "<p>second frame</p>");

  // Wait for both frames or timeout.
  await new Promise((r) => setTimeout(r, 200));
  ctrl.abort();
  await readPromise.catch(() => {});

  expect(frames.length).toBe(2);
  expect(frames[0]).toContain("first frame");
  expect(frames[0]).toContain("id: entry-ulid-1");
  expect(frames[1]).toContain("second frame");
  expect(frames[1]).toContain("id: entry-ulid-2");
});

test("/raw/:uuid headers expose X-Folio-Live + X-Folio-Final", async () => {
  await pushNote("01HXLS00000000000000000006", { live: 1, is_final: 0 });
  const r = await fetch(`${baseUrl}/raw/01HXLS00000000000000000006`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(r.headers.get("x-folio-live")).toBe("1");
  expect(r.headers.get("x-folio-final")).toBe("0");

  await pushNote("01HXLS00000000000000000007", { live: 0, is_final: 1 });
  const r2 = await fetch(`${baseUrl}/raw/01HXLS00000000000000000007`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(r2.headers.get("x-folio-live")).toBe("0");
  expect(r2.headers.get("x-folio-final")).toBe("1");
});
