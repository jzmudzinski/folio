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

test("/n/:uuid serves outer page wrapping /raw/ in sandboxed iframe", async () => {
  const uuid = await pushSample();
  const res = await fetch(`${baseUrl}/n/${uuid}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toContain(`src="/raw/${uuid}"`);
  // Sandbox must NOT include allow-same-origin (the load-bearing isolation
  // invariant). Per AGENTS.md hard rules.
  expect(body).toMatch(/sandbox="[^"]+"/);
  expect(body).not.toContain("allow-same-origin");
});

test("/n/:uuid 404 on unknown uuid", async () => {
  const res = await fetch(`${baseUrl}/n/019e2110-0000-7000-8000-deadbeefdead`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(404);
});

test("/t/:thread_id lists notes JSON", async () => {
  await pushSample();
  const res = await fetch(`${baseUrl}/t/render-t`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { thread_id: string; notes: { uuid: string; title: string }[] };
  expect(body.thread_id).toBe("render-t");
  expect(body.notes).toHaveLength(1);
  expect(body.notes[0]!.title).toBe("Render Sample");
});

test("capability URL routes return 501 (W4 stub)", async () => {
  const res = await fetch(`${baseUrl}/p/some-token/n/some-uuid`);
  expect(res.status).toBe(501);
});
