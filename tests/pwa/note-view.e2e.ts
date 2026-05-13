/**
 * /n/:uuid flow: user taps a note in the home list, the public JS shell
 * fetches /raw/:uuid with the bearer from IDB and loads it into a
 * sandboxed iframe via blob URL.
 *
 * This is the path that broke twice during W3 (SW lifecycle race, then
 * Sec-Fetch-* headers reconstructed wrong). A headless run catches both.
 */

import { test, expect } from "./fixtures";

async function paireToken(page: any, cloud: any) {
  const { token } = await cloud.pairDevice("pw");
  // Seed the IDB token before navigating so the shell can fetch immediately.
  await page.goto(`${cloud.baseUrl}/pair`);
  await page.evaluate(async (t: string) => {
    return new Promise<void>((resolve) => {
      const req = indexedDB.open("folio-pwa", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("kv");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").put(t, "token");
        tx.oncomplete = () => resolve();
      };
    });
  }, token);
  return token;
}

async function seedNote(cloud: any, token: string, uuid: string, title: string, bodyHtml: string, thread = "pw-thread") {
  const res = await fetch(`${cloud.baseUrl}/v1/sync/push`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      notes: [{
        uuid, slug: uuid.toLowerCase(), thread_id: thread, title,
        type: "snippet", body_html: bodyHtml,
        created_at: new Date().toISOString(),
      }],
    }),
  });
  if (!res.ok) throw new Error(`push failed: ${await res.text()}`);
}

test("/n/:uuid shell fetches /raw/, loads into sandboxed iframe via blob:", async ({ page, cloud }) => {
  const token = await paireToken(page, cloud);
  const uuid = "01HXPWNOTE0000000000000001";
  await seedNote(cloud, token, uuid, "Headless render test",
    '<h1>Headless render test</h1><p class="lead">If you see this, the blob iframe handshake works.</p>');

  await page.goto(`${cloud.baseUrl}/n/${uuid}`);

  // Outer shell rendered + iframe wired.
  const iframe = page.locator("#frame");
  await expect(iframe).toBeVisible({ timeout: 5000 });

  // Loading state hidden once iframe loads.
  await expect(page.locator("#state")).toBeHidden({ timeout: 5000 });

  // Iframe content reachable via Playwright's frame API.
  const frame = page.frameLocator("#frame");
  await expect(frame.locator("h1")).toContainText("Headless render test");
  await expect(frame.locator("p.lead")).toContainText("blob iframe handshake works");

  // Sandbox attribute must NOT include allow-same-origin — load-bearing
  // invariant for the whole isolation model.
  const sandbox = await iframe.getAttribute("sandbox");
  expect(sandbox).toBeTruthy();
  expect(sandbox).not.toContain("allow-same-origin");
});

test("/n/:uuid without token shows 'Not paired' + link to /pair", async ({ page, cloud }) => {
  const uuid = "01HXPWNOTE0000000000000002";
  await page.goto(`${cloud.baseUrl}/n/${uuid}`);
  await expect(page.locator("#state")).toContainText(/not paired/i, { timeout: 5000 });
  await expect(page.locator("#state a")).toHaveAttribute("href", "/pair");
});

test("/n/:uuid for unknown id (token present) shows 'Note not found'", async ({ page, cloud }) => {
  await paireToken(page, cloud);
  await page.goto(`${cloud.baseUrl}/n/01HXPWNOTE000000000000DEAD`);
  await expect(page.locator("#state")).toContainText(/not found/i, { timeout: 5000 });
});
