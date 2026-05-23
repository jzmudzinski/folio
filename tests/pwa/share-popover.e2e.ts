/**
 * Share popover stays within the viewport (v0.34.1 fix). The popover is
 * position:fixed and anchored to the sidebar trigger; on a short window — or
 * after its content grows (publish result / error / manage bar) — part of it
 * used to slide below the bottom edge. positionNearTrigger() clamps the top and
 * `.share-pop` now caps height + scrolls. This drives the REAL local viewer in
 * a short window and asserts the popover is fully on-screen.
 *
 * Unlike the other e2e files this starts the local viewer (FOLIO_HOME), not the
 * cloud relay — so it manages its own setup/teardown instead of the `cloud`
 * fixture.
 */

import { test, expect } from "@playwright/test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDb } from "../../src/core/db";

let tmpDir: string;
let viewer: { stop: () => void; port: number; hostname: string } | null = null;
let viewerUrl = "";
let noteId = "";

test.beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "folio-pw-popover-"));
  process.env.FOLIO_HOME = tmpDir;
  closeDb(); // reset the storage db() singleton onto this test's FOLIO_HOME
  const { init } = await import("../../src/cli/commands/init");
  await init();
  const { createNote } = await import("../../src/core/storage");
  const note = await createNote({
    type: "comparison",
    title: "Popover sample",
    body_html: '<p class="lead">Body.</p>',
    thread_id: "popover",
    theme: "linen",
  });
  noteId = note.id;
  const cfgPath = join(tmpDir, "folio.config.json");
  const parsed = JSON.parse(readFileSync(cfgPath, "utf-8"));
  parsed.viewer_port = 0;
  writeFileSync(cfgPath, JSON.stringify(parsed));
  const { startServer } = await import("../../src/viewer/server");
  viewer = (await startServer()) as any;
  viewerUrl = `http://${viewer!.hostname}:${viewer!.port}`;
});

test.afterEach(() => {
  try { viewer?.stop(); } catch {}
  viewer = null;
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.FOLIO_HOME;
});

test("share popover is fully on-screen on a short viewport", async ({ page }) => {
  // Short window: the popover is taller than this, so without the height cap +
  // top clamp its bottom would fall off-screen.
  await page.setViewportSize({ width: 1280, height: 320 });
  await page.goto(`${viewerUrl}/n/${noteId}`);

  const trigger = page.locator("#share-trigger");
  await expect(trigger).toBeVisible({ timeout: 5000 });
  await trigger.click(); // Playwright auto-scrolls the trigger into view

  const pop = page.locator("#share-pop");
  await expect(pop).toHaveClass(/is-open/, { timeout: 2000 });
  await page.waitForTimeout(120); // open() re-clamps after a 60ms paint tick

  const box = await pop.boundingBox();
  const vh = page.viewportSize()!.height;
  expect(box).not.toBeNull();
  // Fully within the viewport, top and bottom.
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vh + 1);
});
