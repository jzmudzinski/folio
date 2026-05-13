/**
 * Playwright config for headless browser tests of the Folio PWA.
 *
 * These tests catch UX regressions that pure unit tests miss — service
 * worker lifecycle, IndexedDB, blob URLs, iframe sandbox handoffs. They
 * run a REAL cloud relay (Bun.serve on an ephemeral port) and drive
 * Chromium against it. See tests/pwa/*.e2e.ts.
 *
 * Setup once:
 *   bun run test:pwa:install
 *
 * Run:
 *   bun run test:pwa                         # all PWA tests
 *   bunx --bun playwright test --ui          # interactive UI
 *   bunx --bun playwright test --headed      # see the browser
 *
 * The `--bun` flag is required because the fixtures import src/cloud/server.ts
 * which uses bun:sqlite — Node's default ESM loader rejects the bun: protocol.
 *
 * Why a separate runner from `bun test`? Playwright bundles its own
 * fixtures (browser, context, page) that don't compose with bun:test's
 * lifecycle. Test files use .e2e.ts (not .spec.ts) so `bun test` skips
 * them by extension. The unit suite is unchanged; this is purely additive.
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/pwa",
  // .e2e.ts (not .spec.ts) so bun:test doesn't try to run them — Playwright's
  // runner needs its own fixture machinery that bun:test can't satisfy.
  testMatch: /.*\.e2e\.ts$/,
  fullyParallel: false, // ephemeral ports + shared cloud state per test = serialize
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    actionTimeout: 5_000,
    navigationTimeout: 10_000,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
