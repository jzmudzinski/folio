/**
 * Capability-URL variant pick (v0.34): a share recipient opens /p/:token/n/:uuid,
 * clicks "Wybieram ten" on a [data-folio-pick] block, and the choice is recorded
 * server-side as a soft preference.
 *
 * This exercises the full cross-iframe handshake that unit tests can't: the body
 * runs in a null-origin sandboxed iframe (CSP connect-src 'none'), so it can't
 * POST — it postMessages the pick to the parent /n page, which does the fetch to
 * /p/:token/pick. A headless click is the only way to prove that wiring end to end.
 */

import { test, expect } from "./fixtures";

async function seedNote(cloud: any, token: string, uuid: string): Promise<void> {
  const res = await fetch(`${cloud.baseUrl}/v1/sync/push`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      notes: [{
        uuid, slug: uuid.toLowerCase(), thread_id: "pick-thread",
        title: "Wybierz kierunek", type: "comparison",
        body_html:
          '<div class="card" data-folio-pick="A" data-folio-pick-label="Kierunek A"><h3>Kierunek A</h3><p>Pierwszy.</p></div>' +
          '<div class="card" data-folio-pick="B" data-folio-pick-label="Kierunek B"><h3>Kierunek B</h3><p>Drugi.</p></div>',
        created_at: new Date().toISOString(),
      }],
    }),
  });
  if (!res.ok) throw new Error(`push failed: ${await res.text()}`);
}

async function createShare(cloud: any, token: string, uuid: string, allowPick: boolean): Promise<{ token: string; url: string }> {
  const res = await fetch(`${cloud.baseUrl}/v1/share`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ scope_type: "note", scope_id: uuid, allow_pick: allowPick }),
  });
  if (!res.ok) throw new Error(`share failed: ${await res.text()}`);
  return (await res.json()) as { token: string; url: string };
}

async function getPicks(cloud: any, token: string, scopeId: string): Promise<any[]> {
  const r = await fetch(`${cloud.baseUrl}/v1/shares?scope_id=${encodeURIComponent(scopeId)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const data = (await r.json()) as { shares: any[] };
  return data.shares[0]?.picks ?? [];
}

test("recipient picks a variant on an allow_pick share → recorded server-side", async ({ page, cloud }) => {
  const { token } = await cloud.pairDevice("pw-pick");
  const uuid = "01HXPWPICK000000000000001";
  await seedNote(cloud, token, uuid);
  const share = await createShare(cloud, token, uuid, true);

  // Open the capability URL — no auth, token lives in the path.
  await page.goto(`${cloud.baseUrl}/p/${share.token}/n/${uuid}`);

  const frame = page.frameLocator("iframe");
  // Variant blocks render and the affordance button is injected per block.
  await expect(frame.locator('[data-folio-pick="A"] .folio-pick-btn')).toBeVisible({ timeout: 5000 });
  const btnB = frame.locator('[data-folio-pick="B"] .folio-pick-btn');
  await btnB.click();
  // Optimistic UI inside the iframe: the clicked button confirms.
  await expect(btnB).toContainText("Wybrano");

  // Server-side: the parent /n page relayed the pick to /p/:token/pick.
  await expect.poll(async () => {
    const picks = await getPicks(cloud, token, uuid);
    return picks.length === 1 ? picks[0].variant : null;
  }, { timeout: 5000 }).toBe("B");

  const picks = await getPicks(cloud, token, uuid);
  expect(picks[0].label).toBe("Kierunek B");
  expect(picks[0].note_uuid).toBe(uuid);
});

test("read-only share (no allow_pick) shows the variants but no pick buttons", async ({ page, cloud }) => {
  const { token } = await cloud.pairDevice("pw-readonly");
  const uuid = "01HXPWPICK000000000000002";
  await seedNote(cloud, token, uuid);
  const share = await createShare(cloud, token, uuid, false);

  await page.goto(`${cloud.baseUrl}/p/${share.token}/n/${uuid}`);

  const frame = page.frameLocator("iframe");
  await expect(frame.locator('[data-folio-pick="A"]')).toBeVisible({ timeout: 5000 });
  await expect(frame.locator(".folio-pick-btn")).toHaveCount(0);

  // And no pick can be recorded — the endpoint refuses (404) without allow_pick.
  expect(await getPicks(cloud, token, uuid)).toHaveLength(0);
});
