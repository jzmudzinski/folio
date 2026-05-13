import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeCloudDb } from "../src/cloud/db";

let tmpDir: string;
let server: { stop: () => void; port: number; hostname: string } | null = null;
let baseUrl: string;
let token: string;
let publicBase: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "folio-cloud-shares-"));
  process.env.FOLIO_CLOUD_HOME = tmpDir;
  const { startCloudServer } = await import("../src/cloud/server");
  server = (await startCloudServer({ port: 0, publicUrl: "https://share.example.com" })) as any;
  baseUrl = `http://${server!.hostname}:${server!.port}`;
  publicBase = "https://share.example.com";

  const { createPairingCode } = await import("../src/cloud/auth");
  const { code } = createPairingCode();
  const pairRes = await fetch(`${baseUrl}/v1/auth/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, device_name: "publisher", device_id: "01HXPUBDEVICE000000000XXXX" }),
  });
  token = ((await pairRes.json()) as { token: string }).token;

  // Seed two notes in two threads so scope tests have material.
  await fetch(`${baseUrl}/v1/sync/push`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      notes: [
        {
          uuid: "01HXNOTE001",
          slug: "alpha",
          thread_id: "alpha-thread",
          title: "Alpha",
          type: "research",
          body_html: "<h1>Alpha</h1>",
          created_at: "2026-05-13T10:00:00Z",
        },
        {
          uuid: "01HXNOTE002",
          slug: "beta",
          thread_id: "alpha-thread",
          title: "Beta",
          type: "snippet",
          body_html: "<h1>Beta</h1>",
          created_at: "2026-05-13T10:05:00Z",
        },
        {
          uuid: "01HXNOTE003",
          slug: "gamma",
          thread_id: "other-thread",
          title: "Gamma",
          type: "snippet",
          body_html: "<h1>Gamma</h1>",
          created_at: "2026-05-13T10:10:00Z",
        },
      ],
    }),
  });
});

afterEach(() => {
  try { server?.stop(); } catch {}
  server = null;
  closeCloudDb();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.FOLIO_CLOUD_HOME;
});

async function createShare(body: Record<string, unknown>): Promise<{
  token: string;
  url: string;
  expires_at: string | null;
  max_views: number | null;
}> {
  const res = await fetch(`${baseUrl}/v1/share`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json() as any;
}

test("POST /v1/share creates a note-scoped share", async () => {
  const s = await createShare({ scope_type: "note", scope_id: "01HXNOTE001", expires_in_days: 7 });
  expect(s.token.length).toBeGreaterThan(20);
  expect(s.url).toBe(`${publicBase}/p/${s.token}/n/01HXNOTE001`);
  expect(s.expires_at).toBeTruthy();
  expect(new Date(s.expires_at!).getTime()).toBeGreaterThan(Date.now());
});

test("POST /v1/share rejects unknown note id", async () => {
  const res = await fetch(`${baseUrl}/v1/share`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ scope_type: "note", scope_id: "01HXNONEXISTENT" }),
  });
  expect(res.status).toBe(400);
});

test("POST /v1/share creates a thread-scoped share", async () => {
  const s = await createShare({ scope_type: "thread", scope_id: "alpha-thread", expires_in_days: 7 });
  expect(s.url).toBe(`${publicBase}/p/${s.token}/t/alpha-thread`);
});

test("/p/<token>/n/<uuid> renders note publicly (no auth header)", async () => {
  const s = await createShare({ scope_type: "note", scope_id: "01HXNOTE001" });
  const r = await fetch(`${baseUrl}/p/${s.token}/n/01HXNOTE001`);
  expect(r.status).toBe(200);
  expect(r.headers.get("x-robots-tag")).toContain("noindex");
  expect(r.headers.get("referrer-policy")).toBe("no-referrer");
  const body = await r.text();
  expect(body).toContain(`src="/p/${s.token}/raw/01HXNOTE001"`);
  expect(body).not.toContain("allow-same-origin");
});

test("/p/<token>/raw/<uuid> renders body with locked CSP", async () => {
  const s = await createShare({ scope_type: "note", scope_id: "01HXNOTE001" });
  const r = await fetch(`${baseUrl}/p/${s.token}/raw/01HXNOTE001`);
  expect(r.status).toBe(200);
  const csp = r.headers.get("content-security-policy") ?? "";
  expect(csp).toContain("connect-src 'none'");
  expect(r.headers.get("x-robots-tag")).toContain("noindex");
  const body = await r.text();
  expect(body).toContain("<h1>Alpha</h1>");
});

test("/p/<token>/n/<other-uuid> rejected (scope mismatch)", async () => {
  const s = await createShare({ scope_type: "note", scope_id: "01HXNOTE001" });
  const r = await fetch(`${baseUrl}/p/${s.token}/n/01HXNOTE002`);
  expect(r.status).toBe(404);
});

test("thread-scoped token grants access to any note in that thread, not others", async () => {
  const s = await createShare({ scope_type: "thread", scope_id: "alpha-thread" });
  // Notes within thread: OK
  const inThread = await fetch(`${baseUrl}/p/${s.token}/n/01HXNOTE002`);
  expect(inThread.status).toBe(200);
  // Note in different thread: rejected
  const outOfThread = await fetch(`${baseUrl}/p/${s.token}/n/01HXNOTE003`);
  expect(outOfThread.status).toBe(404);
  // Thread index itself: OK
  const threadView = await fetch(`${baseUrl}/p/${s.token}/t/alpha-thread`);
  expect(threadView.status).toBe(200);
  const body = await threadView.text();
  expect(body).toContain("Alpha");
  expect(body).toContain("Beta");
  expect(body).not.toContain("Gamma");
  // Other thread: rejected
  const otherThread = await fetch(`${baseUrl}/p/${s.token}/t/other-thread`);
  expect(otherThread.status).toBe(404);
});

test("revoke immediately invalidates the share", async () => {
  const s = await createShare({ scope_type: "note", scope_id: "01HXNOTE001" });
  const before = await fetch(`${baseUrl}/p/${s.token}/n/01HXNOTE001`);
  expect(before.status).toBe(200);

  const del = await fetch(`${baseUrl}/v1/share/${s.token}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  expect(del.status).toBe(200);
  expect(((await del.json()) as { revoked: string | null }).revoked).toBe(s.token);

  const after = await fetch(`${baseUrl}/p/${s.token}/n/01HXNOTE001`);
  expect(after.status).toBe(404);
});

test("expired share returns 410 Gone", async () => {
  // Direct DB poke to backdate expires_at — simulates a real expiry.
  const s = await createShare({ scope_type: "note", scope_id: "01HXNOTE001", expires_in_days: 1 });
  const { cloudDb } = await import("../src/cloud/db");
  cloudDb().run("UPDATE shares SET expires_at = ? WHERE token = ?", ["2000-01-01T00:00:00Z", s.token]);
  const r = await fetch(`${baseUrl}/p/${s.token}/n/01HXNOTE001`);
  expect(r.status).toBe(410);
});

test("max_views caps total accesses", async () => {
  const s = await createShare({ scope_type: "note", scope_id: "01HXNOTE001", max_views: 2 });
  expect((await fetch(`${baseUrl}/p/${s.token}/n/01HXNOTE001`)).status).toBe(200);
  expect((await fetch(`${baseUrl}/p/${s.token}/n/01HXNOTE001`)).status).toBe(200);
  // Third hit blocked.
  expect((await fetch(`${baseUrl}/p/${s.token}/n/01HXNOTE001`)).status).toBe(404);
});

test("/v1/shares lists active shares for the device", async () => {
  await createShare({ scope_type: "note", scope_id: "01HXNOTE001" });
  await createShare({ scope_type: "thread", scope_id: "alpha-thread" });
  const r = await fetch(`${baseUrl}/v1/shares`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = (await r.json()) as { shares: { scope_id: string; scope_type: string }[] };
  expect(body.shares).toHaveLength(2);
  const sids = body.shares.map((s) => s.scope_id).sort();
  expect(sids).toEqual(["01HXNOTE001", "alpha-thread"]);
});

test("/v1/shares filters by scope_id", async () => {
  await createShare({ scope_type: "note", scope_id: "01HXNOTE001" });
  await createShare({ scope_type: "note", scope_id: "01HXNOTE002" });
  const r = await fetch(`${baseUrl}/v1/shares?scope_id=01HXNOTE001`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = (await r.json()) as { shares: { scope_id: string }[] };
  expect(body.shares).toHaveLength(1);
  expect(body.shares[0]!.scope_id).toBe("01HXNOTE001");
});

test("invalid token format returns 404 (no info leak)", async () => {
  expect((await fetch(`${baseUrl}/p/short/n/01HXNOTE001`)).status).toBe(404);
  expect((await fetch(`${baseUrl}/p/${"x".repeat(43)}/n/01HXNOTE001`)).status).toBe(404);
});

test("non-GET on capability route returns 405", async () => {
  const s = await createShare({ scope_type: "note", scope_id: "01HXNOTE001" });
  const r = await fetch(`${baseUrl}/p/${s.token}/n/01HXNOTE001`, { method: "POST" });
  expect(r.status).toBe(405);
});

test("creating share without auth is rejected", async () => {
  const r = await fetch(`${baseUrl}/v1/share`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scope_type: "note", scope_id: "01HXNOTE001" }),
  });
  expect(r.status).toBe(401);
});
