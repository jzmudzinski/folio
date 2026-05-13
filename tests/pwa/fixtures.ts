/**
 * Playwright fixtures for Folio PWA tests.
 *
 * Each test gets a fresh cloud relay running on an ephemeral port with
 * an isolated FOLIO_CLOUD_HOME directory. Tests use a typed `cloud`
 * fixture that exposes the base URL + helpers for the common operations
 * (createPairingCode, pairDevice).
 *
 * We deliberately don't share state across tests — `fullyParallel: false`
 * + workers=1 in playwright.config.ts because the cloud env vars are
 * process-wide.
 */

import { test as base } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export interface CloudFixture {
  baseUrl: string;
  /** Generate a pairing code on the cloud (operator-side). */
  createPairingCode: () => Promise<string>;
  /** Pair a synthetic device and return its bearer token + device_id. */
  pairDevice: (name?: string) => Promise<{ token: string; device_id: string }>;
}

type Fixtures = {
  cloud: CloudFixture;
};

export const test = base.extend<Fixtures>({
  cloud: async ({}, use) => {
    const tmpDir = mkdtempSync(join(tmpdir(), "folio-pw-cloud-"));
    process.env.FOLIO_CLOUD_HOME = tmpDir;
    const { startCloudServer } = await import("../../src/cloud/server");
    const server: any = await startCloudServer({ port: 0, publicUrl: "http://127.0.0.1" });

    const baseUrl = `http://${server.hostname}:${server.port}`;
    const { closeCloudDb } = await import("../../src/cloud/db");

    const fixture: CloudFixture = {
      baseUrl,
      async createPairingCode() {
        const { createPairingCode } = await import("../../src/cloud/auth");
        return createPairingCode().code;
      },
      async pairDevice(name = "test-device") {
        const { createPairingCode } = await import("../../src/cloud/auth");
        const { code } = createPairingCode();
        const deviceId = "01HXTEST" + Math.random().toString(36).slice(2, 12).toUpperCase().padEnd(18, "X");
        const res = await fetch(`${baseUrl}/v1/auth/pair`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code, device_name: name, device_id: deviceId }),
        });
        if (!res.ok) throw new Error(`pair failed: ${await res.text()}`);
        return (await res.json()) as { token: string; device_id: string };
      },
    };

    await use(fixture);

    try { server.stop(); } catch {}
    closeCloudDb();
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.FOLIO_CLOUD_HOME;
  },
});

export { expect } from "@playwright/test";
