import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeCloudDb } from "../src/cloud/db";

let tmpDir: string;
let server: { stop: () => void; port: number; hostname: string } | null = null;
let baseUrl: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "folio-cloud-pwa-"));
  process.env.FOLIO_CLOUD_HOME = tmpDir;
  const { startCloudServer } = await import("../src/cloud/server");
  server = (await startCloudServer({ port: 0, publicUrl: "https://folio.example.com" })) as any;
  baseUrl = `http://${server!.hostname}:${server!.port}`;
});

afterEach(() => {
  try { server?.stop(); } catch {}
  server = null;
  closeCloudDb();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.FOLIO_CLOUD_HOME;
});

test("/ serves app shell HTML without auth", async () => {
  const res = await fetch(`${baseUrl}/`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/html");
  const body = await res.text();
  expect(body).toContain("<!doctype html>");
  expect(body).toContain('<link rel="manifest" href="/manifest.webmanifest">');
  expect(body).toContain("apple-touch-icon");
  expect(body).toContain("folio");
  // Bootstrap registers SW + loads feed.
  expect(body).toContain("serviceWorker");
  expect(body).toContain("/v1/feed");
});

test("/ shell has whoami placeholder + sign-out wiring", async () => {
  const res = await fetch(`${baseUrl}/`);
  const body = await res.text();
  expect(body).toContain('id="whoami"');
  // Bootstrap JS calls whoami + handles sign-out.
  expect(body).toContain("/v1/admin/whoami");
  expect(body).toContain("setupWhoami");
  expect(body).toContain("sign out");
});

test("/ exposes install banner markup + install-prompt handlers", async () => {
  const res = await fetch(`${baseUrl}/`);
  const body = await res.text();
  // Banner is server-rendered; JS toggles .shown only when applicable.
  expect(body).toContain('id="install-banner"');
  expect(body).toContain('id="install-btn"');
  expect(body).toContain('id="install-dismiss"');
  // Install prompt JS handles both Chrome `beforeinstallprompt` and iOS Safari fallback.
  expect(body).toContain("beforeinstallprompt");
  expect(body).toContain("isIosSafari");
  expect(body).toContain("display-mode: standalone");
  expect(body).toContain("Add to Home Screen");
});

test("/pair serves pair form without auth", async () => {
  const res = await fetch(`${baseUrl}/pair`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/html");
  const body = await res.text();
  expect(body).toContain("Pairing code");
  expect(body).toContain('id="code"');
  expect(body).toContain('id="name"');
  // POST target.
  expect(body).toContain("/v1/auth/pair");
  // Client generates own device_id ULID-style for cloud alignment.
  expect(body).toContain("device_id");
});

test("/pair prefills the code from ?code= and auto-submits", async () => {
  // The QR encodes the full /pair?code=NNNNNN URL; the inline JS reads
  // location.search client-side, so the served page is identical regardless of
  // the query string. Assert the prefill + auto-submit logic ships in the page.
  const res = await fetch(`${baseUrl}/pair?code=123456`);
  expect(res.status).toBe(200);
  const body = await res.text();
  // Reads the code param and validates it's exactly 6 digits.
  expect(body).toContain("URLSearchParams(location.search).get('code')");
  expect(body).toContain("/^[0-9]{6}$/.test(codeParam)");
  // Prefills the #code input from the param.
  expect(body).toContain("document.getElementById('code').value = codeParam");
  // Auto-submits the form when the code came from the URL.
  expect(body).toContain("form.requestSubmit()");
});

test("/manifest.webmanifest is valid JSON with required PWA fields", async () => {
  const res = await fetch(`${baseUrl}/manifest.webmanifest`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("manifest+json");
  const body = await res.json();
  expect(body).toMatchObject({
    name: "Folio",
    short_name: "Folio",
    display: "standalone",
    start_url: "/",
    scope: "/",
  });
  expect(Array.isArray((body as any).icons)).toBe(true);
  expect((body as any).icons.length).toBeGreaterThan(0);
});

test("/sw.js served with correct headers", async () => {
  const res = await fetch(`${baseUrl}/sw.js`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("javascript");
  expect(res.headers.get("service-worker-allowed")).toBe("/");
  const body = await res.text();
  // Sanity: it actually contains SW lifecycle hooks + auth injection.
  expect(body).toContain("addEventListener('install'");
  expect(body).toContain("addEventListener('activate'");
  expect(body).toContain("addEventListener('fetch'");
  expect(body).toContain("Authorization");
});

test("/icons/folio.svg served as image/svg+xml", async () => {
  const res = await fetch(`${baseUrl}/icons/folio.svg`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("svg");
  const body = await res.text();
  expect(body).toContain("<svg");
});

test("/v1/feed requires auth + returns shape", async () => {
  const unauth = await fetch(`${baseUrl}/v1/feed`);
  expect(unauth.status).toBe(401);

  // Pair + seed a note.
  const { createPairingCode } = await import("../src/cloud/auth");
  const { code } = createPairingCode();
  const pairRes = await fetch(`${baseUrl}/v1/auth/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, device_name: "test", device_id: "01HXTESTDEVICE0000000000000" }),
  });
  const { token } = (await pairRes.json()) as { token: string };

  await fetch(`${baseUrl}/v1/sync/push`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      notes: [
        {
          uuid: "01HXNOTE001",
          slug: "feed-test",
          thread_id: "t1",
          title: "Feed Test",
          type: "research",
          body_html: "<p>hi</p>",
          created_at: "2026-05-13T10:00:00Z",
        },
      ],
    }),
  });

  const feedRes = await fetch(`${baseUrl}/v1/feed`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(feedRes.status).toBe(200);
  const body = (await feedRes.json()) as {
    notes: { uuid: string; title: string; live: boolean; is_final: boolean }[];
    threads: { thread_id: string; count: number }[];
    sw_version: string;
  };
  expect(body.notes).toHaveLength(1);
  expect(body.notes[0]!.title).toBe("Feed Test");
  expect(body.notes[0]!.live).toBe(false);
  expect(body.notes[0]!.is_final).toBe(false);
  expect(body.threads).toHaveLength(1);
  expect(body.threads[0]!.thread_id).toBe("t1");
  expect(body.threads[0]!.count).toBe(1);
  expect(typeof body.sw_version).toBe("string");
});

test("manifest fields scope to public URL host", async () => {
  const res = await fetch(`${baseUrl}/manifest.webmanifest`);
  const body = (await res.json()) as { id: string };
  expect(body.id).toBe("folio.example.com");
});
