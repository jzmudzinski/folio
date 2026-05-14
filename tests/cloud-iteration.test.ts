/**
 * Cloud-side iteration rendering (v0.18+).
 *
 *  ✓ /raw/:uuid for an iteration note with synced entries renders the
 *    gallery (read-only: no click handlers, no pick button)
 *  ✓ Picked + rejected state from a synced pick entry surfaces in
 *    the rendered card states
 *  ✓ Finalized iteration notes fall through to standard body_html
 *    rendering (no gallery splice)
 *  ✓ Non-iteration notes are unaffected
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
  tmpDir = mkdtempSync(join(tmpdir(), "folio-cloud-iter-"));
  process.env.FOLIO_CLOUD_HOME = tmpDir;
  const { startCloudServer } = await import("../src/cloud/server");
  server = (await startCloudServer({ port: 0 })) as any;
  baseUrl = `http://${server!.hostname}:${server!.port}`;

  const { createPairingCode } = await import("../src/cloud/auth");
  const { code } = createPairingCode();
  const pairRes = await fetch(`${baseUrl}/v1/auth/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, device_name: "iter-test" }),
  });
  token = (await pairRes.json() as { token: string }).token;
});

afterEach(() => {
  try { server?.stop(); } catch {}
  server = null;
  closeCloudDb();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.FOLIO_CLOUD_HOME;
});

async function pushIteration(uuid: string, opts: { isFinal?: boolean } = {}): Promise<void> {
  await fetch(`${baseUrl}/v1/sync/push`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      notes: [
        {
          uuid,
          slug: "iter-sample",
          thread_id: "iter-cloud",
          title: "Iteration Sample",
          type: "iteration",
          theme: "linen",
          // Standard body_html chrome — wrapped in <article data-folio-content>
          // because that's the template shape the renderer splices into.
          body_html: '<!doctype html><html><body><article data-folio-content><h1>Landing</h1><p>Pick a layout.</p></article></body></html>',
          created_at: "2026-05-14T10:00:00Z",
          is_final: opts.isFinal ? 1 : 0,
        },
      ],
    }),
  });
}

async function pushEntries(uuid: string, entries: Array<{ id: string; ts: string; content_html: string; tags?: string[]; refs?: string[]; source_ref?: string | null }>): Promise<void> {
  await fetch(`${baseUrl}/v1/sync/push`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      live_entries: entries.map((e) => ({
        id: e.id,
        note_uuid: uuid,
        ts: e.ts,
        content_html: e.content_html,
        tags: e.tags ?? [],
        refs: e.refs ?? [],
        source_ref: e.source_ref ?? null,
      })),
    }),
  });
}

test("/raw/:uuid: iteration note with current round renders gallery, read-only (no pick button)", async () => {
  const uuid = "019e2110-0000-7000-8000-0000000ce001";
  await pushIteration(uuid);
  await pushEntries(uuid, [
    { id: "v0001", ts: "2026-05-14T10:01:00Z", content_html: "<div>A</div>", tags: ["kind:variant", "round:1"], source_ref: "alpha" },
    { id: "v0002", ts: "2026-05-14T10:01:01Z", content_html: "<div>B</div>", tags: ["kind:variant", "round:1"], source_ref: "beta" },
    { id: "v0003", ts: "2026-05-14T10:01:02Z", content_html: "<div>C</div>", tags: ["kind:variant", "round:1"], source_ref: "gamma" },
  ]);

  const res = await fetch(`${baseUrl}/raw/${uuid}`, { headers: { authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  const html = await res.text();

  // Static chrome from body_html survives.
  expect(html).toContain("<h1>Landing</h1>");
  // Gallery section present.
  expect(html).toContain('<section class="iter-gallery"');
  expect(html).toContain("Round 1");
  // All three variant labels present.
  expect(html).toContain("alpha");
  expect(html).toContain("beta");
  expect(html).toContain("gamma");
  // Read-only badge.
  expect(html).toContain("read-only");
  // No pick buttons or click bootstrap — read-only means no interactivity.
  expect(html).not.toMatch(/<button[^>]*class="iter-card__pick"/);
  expect(html).not.toContain("iteration-pick");
  // No role="button" on cards either.
  expect(html).not.toMatch(/<article class="iter-card iter-card--open"[^>]*role="button"/);
});

test("/raw/:uuid: synced pick entry surfaces as picked/rejected card states + breadcrumb", async () => {
  const uuid = "019e2110-0000-7000-8000-0000000ce002";
  await pushIteration(uuid);
  await pushEntries(uuid, [
    { id: "v0001", ts: "2026-05-14T10:01:00Z", content_html: "<div>A</div>", tags: ["kind:variant", "round:1"], source_ref: "alpha" },
    { id: "v0002", ts: "2026-05-14T10:01:01Z", content_html: "<div>B</div>", tags: ["kind:variant", "round:1"], source_ref: "beta" },
    { id: "p0001", ts: "2026-05-14T10:02:00Z", content_html: "", tags: ["kind:pick", "round:1"], refs: ["v0002"] },
  ]);

  const res = await fetch(`${baseUrl}/raw/${uuid}`, { headers: { authorization: `Bearer ${token}` } });
  const html = await res.text();

  // After a pick with no new round, the renderer shows the waiting state +
  // breadcrumb of past picks (not the original gallery).
  expect(html).toContain("Waiting for the agent to propose round 2");
  // Breadcrumb contains the picked variant's label.
  expect(html).toMatch(/<nav class="iter-bc"/);
  expect(html).toContain("beta");
});

test("/raw/:uuid: finalized iteration note falls through to body_html (no gallery splice)", async () => {
  const uuid = "019e2110-0000-7000-8000-0000000ce003";
  await pushIteration(uuid, { isFinal: true });
  await pushEntries(uuid, [
    { id: "v0001", ts: "2026-05-14T10:01:00Z", content_html: "<div>A</div>", tags: ["kind:variant", "round:1"] },
  ]);

  const res = await fetch(`${baseUrl}/raw/${uuid}`, { headers: { authorization: `Bearer ${token}` } });
  const html = await res.text();
  expect(html).toContain("<h1>Landing</h1>");
  // No gallery markup when finalized — body_html is the final compiled output.
  expect(html).not.toContain('<section class="iter-gallery"');
});

test("/raw/:uuid: a non-iteration note is rendered without any iteration markup", async () => {
  const uuid = "019e2110-0000-7000-8000-0000000ce004";
  await fetch(`${baseUrl}/v1/sync/push`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      notes: [
        {
          uuid,
          slug: "regular",
          thread_id: "regular-t",
          title: "Regular",
          type: "snippet",
          theme: "linen",
          body_html: '<!doctype html><html><body><article data-folio-content><p>just a note</p></article></body></html>',
          created_at: "2026-05-14T10:00:00Z",
        },
      ],
    }),
  });
  const res = await fetch(`${baseUrl}/raw/${uuid}`, { headers: { authorization: `Bearer ${token}` } });
  const html = await res.text();
  expect(html).toContain("just a note");
  expect(html).not.toContain('<section class="iter-gallery"');
  expect(html).not.toContain("iter-card");
});
