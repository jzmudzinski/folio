import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeCloudDb } from "../src/cloud/db";

let tmpDir: string;
let server: { stop: () => void; port: number; hostname: string } | null = null;
let baseUrl: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "folio-cloud-auth-"));
  process.env.FOLIO_CLOUD_HOME = tmpDir;
  const { startCloudServer } = await import("../src/cloud/server");
  server = (await startCloudServer({ port: 0 })) as any;
  baseUrl = `http://${server!.hostname}:${server!.port}`;
});

afterEach(() => {
  try { server?.stop(); } catch {}
  server = null;
  closeCloudDb();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.FOLIO_CLOUD_HOME;
});

test("healthz is public + returns ok", async () => {
  const res = await fetch(`${baseUrl}/healthz`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

test("v1/version is public", async () => {
  const res = await fetch(`${baseUrl}/v1/version`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.name).toBe("folio-cloud");
  expect(typeof body.version).toBe("string");
});

test("authed routes return 401 without bearer", async () => {
  const res = await fetch(`${baseUrl}/v1/sync/pull?since=0`);
  expect(res.status).toBe(401);
  expect((await res.json()).error).toBe("unauthorized");
});

test("authed routes return 401 with invalid bearer", async () => {
  const res = await fetch(`${baseUrl}/v1/sync/pull?since=0`, {
    headers: { authorization: "Bearer not-a-real-token-1234567890" },
  });
  expect(res.status).toBe(401);
});

test("pairing flow: code → token → authed access", async () => {
  const { createPairingCode } = await import("../src/cloud/auth");
  const { code } = createPairingCode();

  // Pair
  const pairRes = await fetch(`${baseUrl}/v1/auth/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, device_name: "test-laptop" }),
  });
  expect(pairRes.status).toBe(200);
  const { device_id, token } = (await pairRes.json()) as { device_id: string; token: string };
  expect(device_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(token.length).toBeGreaterThan(20);

  // Authed pull should now succeed
  const pullRes = await fetch(`${baseUrl}/v1/sync/pull?since=0`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(pullRes.status).toBe(200);
  const body = (await pullRes.json()) as { notes: unknown[]; cursor: number };
  expect(body.notes).toEqual([]);
  expect(body.cursor).toBe(0);
});

test("pairing rejects invalid code", async () => {
  const res = await fetch(`${baseUrl}/v1/auth/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: "999999", device_name: "test" }),
  });
  expect(res.status).toBe(400);
});

test("device list + revoke flow", async () => {
  const { createPairingCode } = await import("../src/cloud/auth");
  const { code } = createPairingCode();
  const pairRes = await fetch(`${baseUrl}/v1/auth/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, device_name: "doomed-laptop" }),
  });
  const { device_id, token } = (await pairRes.json()) as { device_id: string; token: string };

  // List shows 1 device
  const listRes = await fetch(`${baseUrl}/v1/auth/devices`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(listRes.status).toBe(200);
  const { devices } = (await listRes.json()) as { devices: { id: string; name: string }[] };
  expect(devices).toHaveLength(1);
  expect(devices[0]!.name).toBe("doomed-laptop");

  // Revoke
  const revokeRes = await fetch(`${baseUrl}/v1/auth/device/${device_id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  expect(revokeRes.status).toBe(200);

  // Now the same token is unauthorized
  const followup = await fetch(`${baseUrl}/v1/sync/pull?since=0`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(followup.status).toBe(401);
});

test("re-consume of pairing code rotates token on the same device", async () => {
  const { createPairingCode } = await import("../src/cloud/auth");
  const { code } = createPairingCode();
  const r1 = await fetch(`${baseUrl}/v1/auth/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, device_name: "laptop" }),
  });
  const { device_id: id1, token: t1 } = (await r1.json()) as { device_id: string; token: string };

  // Reuse the same code: same device row, new token, old token invalidated.
  const r2 = await fetch(`${baseUrl}/v1/auth/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, device_name: "laptop" }),
  });
  const { device_id: id2, token: t2 } = (await r2.json()) as { device_id: string; token: string };
  expect(id2).toBe(id1);
  expect(t2).not.toBe(t1);

  // Old token rejected
  const stale = await fetch(`${baseUrl}/v1/sync/pull?since=0`, {
    headers: { authorization: `Bearer ${t1}` },
  });
  expect(stale.status).toBe(401);

  // New token works
  const fresh = await fetch(`${baseUrl}/v1/sync/pull?since=0`, {
    headers: { authorization: `Bearer ${t2}` },
  });
  expect(fresh.status).toBe(200);
});
