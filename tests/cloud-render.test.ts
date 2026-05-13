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
  tmpDir = mkdtempSync(join(tmpdir(), "folio-cloud-render-"));
  process.env.FOLIO_CLOUD_HOME = tmpDir;
  const { startCloudServer } = await import("../src/cloud/server");
  server = (await startCloudServer({ port: 0 })) as any;
  baseUrl = `http://${server!.hostname}:${server!.port}`;

  const { createPairingCode } = await import("../src/cloud/auth");
  const { code } = createPairingCode();
  const pairRes = await fetch(`${baseUrl}/v1/auth/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, device_name: "render-test" }),
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

async function pushSample(): Promise<string> {
  const uuid = "019e2110-0000-7000-8000-000000000a01";
  await fetch(`${baseUrl}/v1/sync/push`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      notes: [
        {
          uuid,
          slug: "render-sample",
          thread_id: "render-t",
          title: "Render Sample",
          type: "research",
          theme: "linen",
          body_html: '<h1>Rendered</h1><p class="lead">Hello cloud.</p>',
          created_at: "2026-05-13T10:00:00Z",
        },
      ],
    }),
  });
  return uuid;
}

test("/raw/:uuid serves theme'd HTML with CSP locked down", async () => {
  const uuid = await pushSample();
  const res = await fetch(`${baseUrl}/raw/${uuid}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(200);

  const csp = res.headers.get("content-security-policy") ?? "";
  expect(csp).toContain("connect-src 'none'");
  expect(csp).toContain("frame-ancestors 'self'");
  expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  expect(res.headers.get("referrer-policy")).toBe("no-referrer");

  const body = await res.text();
  expect(body).toContain("<!doctype html>");
  expect(body).toContain("<h1>Rendered</h1>");
  expect(body).toContain('class="lead"');
  // Theme CSS inlined
  expect(body).toMatch(/<style>[\s\S]+:root/);
});

test("/n/:uuid is a public JS shell that fetches /raw/ with auth", async () => {
  const uuid = await pushSample();
  // PUBLIC: works without Authorization header — outer is stateless.
  const res = await fetch(`${baseUrl}/n/${uuid}`);
  expect(res.status).toBe(200);
  const body = await res.text();
  // Shell embeds the uuid as a JS constant and fetches /raw/ inline.
  expect(body).toContain(uuid);
  expect(body).toContain("/raw/");
  // Sandbox must NOT include allow-same-origin (the load-bearing isolation
  // invariant). Per AGENTS.md hard rules.
  expect(body).toMatch(/sandbox="[^"]+"/);
  expect(body).not.toContain("allow-same-origin");
  // Token reads from IDB inside the page — never in URL or query string.
  expect(body).toContain("indexedDB.open('folio-pwa'");
});

test("/n/:uuid serves shell even for unknown uuids — inner /raw/ fetch handles 404", async () => {
  // Public outer = same response regardless of whether the uuid exists.
  const res = await fetch(`${baseUrl}/n/019eDEADBEEF`);
  expect(res.status).toBe(200);
});

test("/t/:thread_id is a public JS shell (W3b)", async () => {
  await pushSample();
  // Public — no auth required for shell. Data comes from /v1/feed?thread=.
  const res = await fetch(`${baseUrl}/t/render-t`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/html");
  const body = await res.text();
  expect(body).toContain("<!doctype html>");
  // Shell reads location.pathname to detect thread context.
  expect(body).toContain("/t/");
});

test("/v1/feed?thread= filters to a single thread", async () => {
  await pushSample();
  // Add another note in a different thread.
  await fetch(`${baseUrl}/v1/sync/push`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      notes: [
        {
          uuid: "019e2110-0000-7000-8000-000000000b02",
          slug: "other-thread-note",
          thread_id: "other-thread",
          title: "Different Thread",
          type: "snippet",
          body_html: "<p>x</p>",
          created_at: "2026-05-13T10:30:00Z",
        },
      ],
    }),
  });
  const filtered = await fetch(`${baseUrl}/v1/feed?thread=render-t`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = (await filtered.json()) as { notes: { thread_id: string }[]; thread: string };
  expect(body.thread).toBe("render-t");
  expect(body.notes).toHaveLength(1);
  expect(body.notes[0]!.thread_id).toBe("render-t");
});

test("/v1/feed?q= does case-insensitive LIKE across title + plain_text", async () => {
  await pushSample();
  await fetch(`${baseUrl}/v1/sync/push`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      notes: [
        {
          uuid: "019e2110-0000-7000-8000-000000000b03",
          slug: "alpha",
          thread_id: "search-t",
          title: "Alpha Beta",
          type: "snippet",
          body_html: "<p>nothing special</p>",
          plain_text: "alpha beta plain content",
          created_at: "2026-05-13T11:00:00Z",
        },
        {
          uuid: "019e2110-0000-7000-8000-000000000b04",
          slug: "gamma",
          thread_id: "search-t",
          title: "Gamma Delta",
          type: "snippet",
          body_html: "<p>different</p>",
          plain_text: "gamma delta different text",
          created_at: "2026-05-13T11:10:00Z",
        },
      ],
    }),
  });

  // Match in title (case-insensitive).
  let r = await fetch(`${baseUrl}/v1/feed?q=alpha`, {
    headers: { authorization: `Bearer ${token}` },
  });
  let body = (await r.json()) as { notes: { uuid: string }[]; query: string };
  expect(body.query).toBe("alpha");
  expect(body.notes.map((n) => n.uuid)).toContain("019e2110-0000-7000-8000-000000000b03");

  // Multi-token AND.
  r = await fetch(`${baseUrl}/v1/feed?q=alpha%20plain`, {
    headers: { authorization: `Bearer ${token}` },
  });
  body = (await r.json()) as { notes: { uuid: string }[]; query: string };
  expect(body.notes.map((n) => n.uuid)).toContain("019e2110-0000-7000-8000-000000000b03");
  expect(body.notes.map((n) => n.uuid)).not.toContain("019e2110-0000-7000-8000-000000000b04");

  // Special LIKE chars escaped — % in query shouldn't wildcard.
  r = await fetch(`${baseUrl}/v1/feed?q=%25%25%25`, {
    headers: { authorization: `Bearer ${token}` },
  });
  body = (await r.json()) as { notes: { uuid: string }[] };
  expect(body.notes).toHaveLength(0);
});

test("capability URL routes return 501 (W4 stub)", async () => {
  const res = await fetch(`${baseUrl}/p/some-token/n/some-uuid`);
  expect(res.status).toBe(501);
});
