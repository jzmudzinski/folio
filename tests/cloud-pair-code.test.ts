/**
 * /v1/auth/pair-code (authed) — paired devices can request fresh pairing
 * codes for onboarding additional devices, no SSH-to-server step required.
 *
 * The returned code is then consumable by any device via /v1/auth/pair
 * with the device's own id, same flow as the operator-generated code
 * from `folio cloud pair-code`.
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
  tmpDir = mkdtempSync(join(tmpdir(), "folio-pair-code-"));
  process.env.FOLIO_CLOUD_HOME = tmpDir;
  const { startCloudServer } = await import("../src/cloud/server");
  server = (await startCloudServer({ port: 0 })) as any;
  baseUrl = `http://${server!.hostname}:${server!.port}`;

  // Pair an "operator" device so we have a bearer token.
  const { createPairingCode } = await import("../src/cloud/auth");
  const { code } = createPairingCode();
  const pairRes = await fetch(`${baseUrl}/v1/auth/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, device_name: "operator", device_id: "01HXOP000000000000000000XX" }),
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

test("POST /v1/auth/pair-code (authed) returns 6-digit code + expiry", async () => {
  const res = await fetch(`${baseUrl}/v1/auth/pair-code`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { code: string; expires_at: string };
  expect(body.code).toMatch(/^[0-9]{6}$/);
  expect(new Date(body.expires_at).getTime()).toBeGreaterThan(Date.now());
});

test("POST /v1/auth/pair-code rejects without bearer", async () => {
  const res = await fetch(`${baseUrl}/v1/auth/pair-code`, { method: "POST" });
  expect(res.status).toBe(401);
});

test("generated code is consumable via /v1/auth/pair (full onboard flow)", async () => {
  const r1 = await fetch(`${baseUrl}/v1/auth/pair-code`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  const { code } = (await r1.json()) as { code: string };

  // A "second device" pairs using the code, with its own client device_id.
  const r2 = await fetch(`${baseUrl}/v1/auth/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, device_name: "phone", device_id: "01HXPHONE0000000000000000XX" }),
  });
  expect(r2.status).toBe(200);
  const body = (await r2.json()) as { device_id: string; token: string };
  expect(body.device_id).toBe("01HXPHONE0000000000000000XX");
  expect(body.token.length).toBeGreaterThan(20);

  // The new token authenticates the second device.
  const r3 = await fetch(`${baseUrl}/v1/sync/pull?since=0`, {
    headers: { authorization: `Bearer ${body.token}` },
  });
  expect(r3.status).toBe(200);
});
