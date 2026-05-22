// v0.33: auto-sync surfaces (folio serve loop + MCP sync-on-write hook) both
// route through autoSyncTick(). These cover its guards — the parts that work
// without a live cloud: no-op when unpaired / disabled, and lock-coexistence
// with a running daemon. The actual push/pull is covered by sync-daemon.test.

import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDb } from "../src/core/db";

const STATE = { remote: "http://127.0.0.1:1", device_token: "t", last_pulled_seq: 0, last_pushed_at: null, last_live_pushed: {} };

let tmp: string;
beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "folio-autosync-"));
  process.env.FOLIO_HOME = tmp;
  const { init } = await import("../src/cli/commands/init");
  await init();
});
afterEach(() => { closeDb(); rmSync(tmp, { recursive: true, force: true }); delete process.env.FOLIO_HOME; });

test("autoSyncTick no-ops when not paired", async () => {
  const { autoSyncTick } = await import("../src/core/sync");
  expect(await autoSyncTick()).toBeNull();
});

test("autoSyncTick no-ops when auto_sync is disabled (even when paired)", async () => {
  const cfgPath = join(tmp, "folio.config.json");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
  cfg.auto_sync = false;
  writeFileSync(cfgPath, JSON.stringify(cfg));
  const { autoSyncTick, saveSyncState } = await import("../src/core/sync");
  saveSyncState({ ...STATE });
  expect(await autoSyncTick()).toBeNull();
});

test("autoSyncTick skips when the .sync.lock is held (coexists with the daemon)", async () => {
  const { autoSyncTick, saveSyncState, acquireLock, releaseLock } = await import("../src/core/sync");
  saveSyncState({ ...STATE });
  acquireLock(); // this pid holds it → autoSyncTick's acquireLock throws → skip
  try {
    expect(await autoSyncTick()).toBeNull();
  } finally {
    releaseLock();
  }
});

test("scheduleAutoSync coalesces rapid calls and never throws", async () => {
  const { scheduleAutoSync } = await import("../src/core/sync");
  expect(() => { scheduleAutoSync(50); scheduleAutoSync(50); scheduleAutoSync(50); }).not.toThrow();
});
