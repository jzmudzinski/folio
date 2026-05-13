/**
 * /pair flow: the most-trafficked first-time path. Catches regressions in
 * the IndexedDB token write, the device_id generation, the form validation,
 * and the redirect to /.
 *
 * What `bun test` (server-side) misses:
 *   - The actual IDB write succeeds (JS runs in browser, not just fetched HTML)
 *   - The redirect navigates AFTER the token is committed (not before)
 *   - The home page's bootstrap reads the IDB token and renders feed
 */

import { test, expect } from "./fixtures";

test("/pair → submit → IDB has token → home loads", async ({ page, cloud }) => {
  const code = await cloud.createPairingCode();

  await page.goto(`${cloud.baseUrl}/pair`);
  await expect(page.locator("h1")).toContainText("Pair with folio");

  await page.locator("#code").fill(code);
  // Form auto-fills `name` from userAgent; clear and set explicit value.
  await page.locator("#name").fill("playwright-test");
  await page.locator("#submit").click();

  // After pair, JS writes token to IDB and redirects to /.
  await page.waitForURL(`${cloud.baseUrl}/`, { timeout: 5000 });

  // IDB now contains a token.
  const token = await page.evaluate(async () => {
    return new Promise<string | undefined>((resolve) => {
      const req = indexedDB.open("folio-pwa", 1);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("kv", "readonly");
        const getReq = tx.objectStore("kv").get("token");
        getReq.onsuccess = () => resolve(getReq.result as string | undefined);
      };
    });
  });
  expect(token).toBeTruthy();
  expect((token ?? "").length).toBeGreaterThan(20);

  // Home page rendered without a redirect back to /pair (means token worked).
  expect(page.url()).toBe(`${cloud.baseUrl}/`);
  await expect(page.locator("header.top .brand")).toContainText("folio");
});

test("/pair rejects bad code with visible error, no IDB write", async ({ page, cloud }) => {
  await page.goto(`${cloud.baseUrl}/pair`);
  await page.locator("#code").fill("999999");
  await page.locator("#name").fill("bad-test");
  await page.locator("#submit").click();

  await expect(page.locator("#err")).toBeVisible({ timeout: 3000 });
  await expect(page.locator("#err")).toContainText(/invalid|pair/i);

  // Still on /pair.
  expect(page.url()).toContain("/pair");

  // No token in IDB.
  const token = await page.evaluate(async () => {
    return new Promise<string | undefined>((resolve) => {
      const req = indexedDB.open("folio-pwa", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("kv");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("kv", "readonly");
        const getReq = tx.objectStore("kv").get("token");
        getReq.onsuccess = () => resolve(getReq.result as string | undefined);
      };
    });
  });
  expect(token).toBeUndefined();
});

test("/ with no token in IDB redirects to /pair", async ({ page, cloud }) => {
  await page.goto(`${cloud.baseUrl}/`);
  await page.waitForURL(`${cloud.baseUrl}/pair`, { timeout: 5000 });
  expect(page.url()).toContain("/pair");
});
