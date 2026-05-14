/**
 * 3-user isolation: Alice / Bob / Carol all paired to one cloud, each
 * device's bearer scopes every read + write to its own user_id.
 *
 *  ✓ Same (thread_id, slug) works across users (no UNIQUE collision).
 *  ✓ /v1/feed returns only the caller's user's notes.
 *  ✓ /v1/sync/pull returns only the caller's user's rows.
 *  ✓ /v1/admin/stats shows only the caller's user's counts.
 *  ✓ /raw/:uuid and /n/:uuid 404 across users.
 *  ✓ Capability URL works cross-user (URL is the credential, no Folio acct).
 *  ✓ Pairing code minted by Alice creates Alice-owned device only.
 */

import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeCloudDb, cloudDb } from "../src/cloud/db";

let tmpDir: string;
let server: { stop: () => void; port: number; hostname: string } | null = null;
let baseUrl: string;

async function addUser(id: string, display = id): Promise<void> {
  cloudDb().run(
    "INSERT INTO users (id, display_name, created_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
    [id, display]
  );
}

async function pairAs(userId: string, deviceName = `${userId}-laptop`, deviceId?: string): Promise<string> {
  const { createPairingCode } = await import("../src/cloud/auth");
  const { code } = createPairingCode(userId);
  const res = await fetch(`${baseUrl}/v1/auth/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, device_name: deviceName, device_id: deviceId ?? `01HX${userId.toUpperCase().padEnd(8, "X")}DEVICE0000000` }),
  });
  return ((await res.json()) as { token: string }).token;
}

async function push(token: string, notes: any[]): Promise<any> {
  const res = await fetch(`${baseUrl}/v1/sync/push`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ notes }),
  });
  return res.json();
}

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "folio-multi-user-"));
  process.env.FOLIO_CLOUD_HOME = tmpDir;
  const { startCloudServer } = await import("../src/cloud/server");
  server = (await startCloudServer({ port: 0, publicUrl: "https://folio.example.com" })) as any;
  baseUrl = `http://${server!.hostname}:${server!.port}`;
  await addUser("alice", "Alice");
  await addUser("bob", "Bob");
  await addUser("carol", "Carol");
});

afterEach(() => {
  try { server?.stop(); } catch {}
  server = null;
  closeCloudDb();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.FOLIO_CLOUD_HOME;
});

test("two users can have the same (thread_id, slug) — UNIQUE is per-user", async () => {
  const aliceTok = await pairAs("alice");
  const bobTok = await pairAs("bob");

  const aliceResp = await push(aliceTok, [{
    uuid: "01HXALICE000000000000000",
    slug: "alpha",
    thread_id: "morning",
    title: "Alice morning",
    type: "journal",
    body_html: "<p>alice</p>",
    created_at: "2026-05-15T08:00:00Z",
  }]);
  expect(aliceResp.notes).toHaveLength(1);
  expect(aliceResp.notes[0].canonical_slug).toBe("alpha");

  const bobResp = await push(bobTok, [{
    uuid: "01HXBOB0000000000000000X",
    slug: "alpha",
    thread_id: "morning",
    title: "Bob morning",
    type: "journal",
    body_html: "<p>bob</p>",
    created_at: "2026-05-15T08:30:00Z",
  }]);
  // Bob keeps his slug 'alpha' (no rename) — Alice's row is in a different user_id partition.
  expect(bobResp.notes[0].canonical_slug).toBe("alpha");
});

test("/v1/feed returns only the caller's user's notes", async () => {
  const aliceTok = await pairAs("alice");
  const bobTok = await pairAs("bob");
  await push(aliceTok, [{
    uuid: "01HXALICE001",
    slug: "a",
    thread_id: "t",
    title: "Alice note",
    type: "snippet",
    body_html: "<p>a</p>",
    created_at: "2026-05-15T09:00:00Z",
  }]);
  await push(bobTok, [{
    uuid: "01HXBOB001",
    slug: "b",
    thread_id: "t",
    title: "Bob note",
    type: "snippet",
    body_html: "<p>b</p>",
    created_at: "2026-05-15T09:05:00Z",
  }]);

  const aliceFeed = (await (await fetch(`${baseUrl}/v1/feed`, {
    headers: { Authorization: `Bearer ${aliceTok}` },
  })).json()) as { notes: { uuid: string; title: string }[]; threads: any[] };
  expect(aliceFeed.notes).toHaveLength(1);
  expect(aliceFeed.notes[0].title).toBe("Alice note");

  const bobFeed = (await (await fetch(`${baseUrl}/v1/feed`, {
    headers: { Authorization: `Bearer ${bobTok}` },
  })).json()) as { notes: { uuid: string; title: string }[] };
  expect(bobFeed.notes).toHaveLength(1);
  expect(bobFeed.notes[0].title).toBe("Bob note");
});

test("/v1/sync/pull returns only the caller's notes + live entries + tombstones", async () => {
  const aliceTok = await pairAs("alice");
  const bobTok = await pairAs("bob");

  await push(aliceTok, [{
    uuid: "01HXALICE-PULL-1",
    slug: "p1",
    thread_id: "x",
    title: "A1",
    type: "snippet",
    body_html: "<p>a1</p>",
    created_at: "2026-05-15T09:00:00Z",
  }]);
  await push(bobTok, [{
    uuid: "01HXBOB-PULL-1",
    slug: "p1",
    thread_id: "x",
    title: "B1",
    type: "snippet",
    body_html: "<p>b1</p>",
    created_at: "2026-05-15T09:05:00Z",
  }]);

  const alicePull = (await (await fetch(`${baseUrl}/v1/sync/pull?since=0`, {
    headers: { Authorization: `Bearer ${aliceTok}` },
  })).json()) as { notes: { uuid: string }[]; live_entries: any[]; tombstones: any[] };
  expect(alicePull.notes.map((n) => n.uuid)).toEqual(["01HXALICE-PULL-1"]);

  const bobPull = (await (await fetch(`${baseUrl}/v1/sync/pull?since=0`, {
    headers: { Authorization: `Bearer ${bobTok}` },
  })).json()) as { notes: { uuid: string }[] };
  expect(bobPull.notes.map((n) => n.uuid)).toEqual(["01HXBOB-PULL-1"]);
});

test("/raw/<uuid> across users: cross-user access returns 404", async () => {
  const aliceTok = await pairAs("alice");
  const bobTok = await pairAs("bob");
  await push(aliceTok, [{
    uuid: "01HXALICE-RAW",
    slug: "r",
    thread_id: "t",
    title: "Secret",
    type: "research",
    body_html: "<p>secret</p>",
    created_at: "2026-05-15T09:00:00Z",
  }]);
  // Alice can read her own /raw.
  const ok = await fetch(`${baseUrl}/raw/01HXALICE-RAW`, {
    headers: { Authorization: `Bearer ${aliceTok}` },
  });
  expect(ok.status).toBe(200);
  // Bob cannot.
  const denied = await fetch(`${baseUrl}/raw/01HXALICE-RAW`, {
    headers: { Authorization: `Bearer ${bobTok}` },
  });
  expect(denied.status).toBe(404);
});

test("/v1/admin/stats is per-user — Bob sees 0 of Alice's data", async () => {
  const aliceTok = await pairAs("alice");
  const bobTok = await pairAs("bob");
  await push(aliceTok, [
    {
      uuid: "01HXALICE-S1",
      slug: "s1",
      thread_id: "ops",
      title: "A1",
      type: "snippet",
      body_html: "<p>a</p>",
      created_at: "2026-05-15T09:00:00Z",
    },
    {
      uuid: "01HXALICE-S2",
      slug: "s2",
      thread_id: "ops",
      title: "A2",
      type: "snippet",
      body_html: "<p>a2</p>",
      created_at: "2026-05-15T09:05:00Z",
    },
  ]);

  const aliceStats = (await (await fetch(`${baseUrl}/v1/admin/stats`, {
    headers: { Authorization: `Bearer ${aliceTok}` },
  })).json()) as any;
  expect(aliceStats.user_id).toBe("alice");
  expect(aliceStats.counts.notes).toBe(2);
  expect(aliceStats.counts.devices_active).toBe(1);

  const bobStats = (await (await fetch(`${baseUrl}/v1/admin/stats`, {
    headers: { Authorization: `Bearer ${bobTok}` },
  })).json()) as any;
  expect(bobStats.user_id).toBe("bob");
  expect(bobStats.counts.notes).toBe(0);
  expect(bobStats.counts.devices_active).toBe(1); // own device only
});

test("/v1/auth/devices is per-user — Alice sees her devices only", async () => {
  const aliceTok = await pairAs("alice", "alice-laptop");
  await pairAs("alice", "alice-phone", "01HXALICE-PHONE-DEV0000");
  await pairAs("bob", "bob-laptop");

  const aliceDevs = (await (await fetch(`${baseUrl}/v1/auth/devices`, {
    headers: { Authorization: `Bearer ${aliceTok}` },
  })).json()) as { devices: { name: string; userId?: string }[] };
  expect(aliceDevs.devices).toHaveLength(2);
  expect(aliceDevs.devices.map((d) => d.name).sort()).toEqual(["alice-laptop", "alice-phone"]);
});

test("/v1/auth/pair-code from Alice scopes the new device to Alice", async () => {
  const aliceTok = await pairAs("alice");

  // Alice mints a code via the authed endpoint (PWA "+ Add another device").
  const codeRes = (await (await fetch(`${baseUrl}/v1/auth/pair-code`, {
    method: "POST",
    headers: { Authorization: `Bearer ${aliceTok}` },
  })).json()) as { code: string; user_id: string };
  expect(codeRes.user_id).toBe("alice");

  // A new device pairs with that code.
  const pairRes = (await (await fetch(`${baseUrl}/v1/auth/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: codeRes.code, device_name: "alice-2nd", device_id: "01HXALICE-2ND-DEV00" }),
  })).json()) as { device_id: string; token: string };

  // Verify the new device row belongs to Alice.
  const row = cloudDb()
    .query<{ user_id: string }, [string]>("SELECT user_id FROM devices WHERE id = ?")
    .get(pairRes.device_id);
  expect(row?.user_id).toBe("alice");
});

test("capability URL works cross-user: Alice shares with Bob, Bob reads it", async () => {
  const aliceTok = await pairAs("alice");
  const bobTok = await pairAs("bob");
  const uuid = "01HXSHARE-X-USR";
  await push(aliceTok, [{
    uuid,
    slug: "shared",
    thread_id: "shared",
    title: "Shared",
    type: "research",
    body_html: "<p>shared bytes</p>",
    created_at: "2026-05-15T09:00:00Z",
  }]);

  // Alice mints a capability URL for the note.
  const shareRes = (await (await fetch(`${baseUrl}/v1/share`, {
    method: "POST",
    headers: { Authorization: `Bearer ${aliceTok}`, "content-type": "application/json" },
    body: JSON.stringify({ scope_type: "note", scope_id: uuid }),
  })).json()) as { token: string; url: string };

  // Bob (or anyone) hits the capability URL — works regardless of Bob's account.
  const r = await fetch(`${baseUrl}/p/${shareRes.token}/n/${uuid}`);
  expect(r.status).toBe(200);

  // The /raw/ behind it also works through the capability scope.
  const raw = await fetch(`${baseUrl}/p/${shareRes.token}/raw/${uuid}`);
  expect(raw.status).toBe(200);
  expect(await raw.text()).toContain("shared bytes");

  // Bob's own bearer canNOT directly access /raw/uuid (that's Alice's note).
  const direct = await fetch(`${baseUrl}/raw/${uuid}`, {
    headers: { Authorization: `Bearer ${bobTok}` },
  });
  expect(direct.status).toBe(404);
});

test("Bob cannot create a share over Alice's note (uuid leaked)", async () => {
  const aliceTok = await pairAs("alice");
  const bobTok = await pairAs("bob");
  const uuid = "01HXALICE-PRIV";
  await push(aliceTok, [{
    uuid,
    slug: "priv",
    thread_id: "priv",
    title: "Private",
    type: "research",
    body_html: "<p>priv</p>",
    created_at: "2026-05-15T09:00:00Z",
  }]);

  // Bob attempts to publish a share for Alice's note.
  const r = await fetch(`${baseUrl}/v1/share`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bobTok}`, "content-type": "application/json" },
    body: JSON.stringify({ scope_type: "note", scope_id: uuid }),
  });
  expect(r.status).toBe(400);
  const body = (await r.json()) as { error: string };
  expect(body.error).toContain("not found");
});

test("Bob cannot push a delete against Alice's uuid (silently skipped)", async () => {
  const aliceTok = await pairAs("alice");
  const bobTok = await pairAs("bob");
  const uuid = "01HXALICE-PROTECTED";
  await push(aliceTok, [{
    uuid,
    slug: "p",
    thread_id: "p",
    title: "Protected",
    type: "snippet",
    body_html: "<p>p</p>",
    created_at: "2026-05-15T09:00:00Z",
  }]);

  const r = await fetch(`${baseUrl}/v1/sync/push`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bobTok}`, "content-type": "application/json" },
    body: JSON.stringify({ deletes: [uuid] }),
  });
  expect(r.status).toBe(200);
  const body = (await r.json()) as { deletes: string[] };
  expect(body.deletes).toHaveLength(0); // silent skip — Alice's note still alive

  // Confirm Alice's note still exists.
  const stillThere = await fetch(`${baseUrl}/raw/${uuid}`, {
    headers: { Authorization: `Bearer ${aliceTok}` },
  });
  expect(stillThere.status).toBe(200);
});

test("asset URL rescope: /raw/ body_html refs rewritten to /u/<user>/t/.../asset/...", async () => {
  const aliceTok = await pairAs("alice");
  await push(aliceTok, [{
    uuid: "01HXALICE-IMG",
    slug: "with-img",
    thread_id: "gallery",
    title: "With image",
    type: "snippet",
    body_html: `<p>see this:</p><img src="/t/gallery/asset/pic.png" alt="x">`,
    created_at: "2026-05-15T09:00:00Z",
  }]);

  const r = await fetch(`${baseUrl}/raw/01HXALICE-IMG`, {
    headers: { Authorization: `Bearer ${aliceTok}` },
  });
  expect(r.status).toBe(200);
  const body = await r.text();
  // src rewritten to per-user namespace.
  expect(body).toContain('src="/u/alice/t/gallery/asset/pic.png"');
  expect(body).not.toMatch(/src="\/t\/gallery\/asset/);
});

test("asset URL /u/<user>/.../ pinned to that user — wrong user 404s", async () => {
  const aliceTok = await pairAs("alice");
  const bobTok = await pairAs("bob");

  // Both users push assets with same (thread, filename).
  const bytes = new TextEncoder().encode("alice's bytes");
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256").update(bytes).digest("hex");
  await fetch(`${baseUrl}/v1/sync/assets/${hash}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${aliceTok}`,
      "content-type": "application/octet-stream",
      "x-folio-filename": "shared-name.png",
      "x-folio-thread-id": "morning",
    },
    body: bytes,
  });

  const bobBytes = new TextEncoder().encode("bob's bytes — same filename");
  const bobHash = createHash("sha256").update(bobBytes).digest("hex");
  await fetch(`${baseUrl}/v1/sync/assets/${bobHash}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bobTok}`,
      "content-type": "application/octet-stream",
      "x-folio-filename": "shared-name.png",
      "x-folio-thread-id": "morning",
    },
    body: bobBytes,
  });

  // /u/alice/... serves Alice's bytes.
  const aliceGet = await fetch(`${baseUrl}/u/alice/t/morning/asset/shared-name.png`);
  expect(aliceGet.status).toBe(200);
  expect(new Uint8Array(await aliceGet.arrayBuffer())).toEqual(bytes);

  // /u/bob/... serves Bob's.
  const bobGet = await fetch(`${baseUrl}/u/bob/t/morning/asset/shared-name.png`);
  expect(bobGet.status).toBe(200);
  expect(new Uint8Array(await bobGet.arrayBuffer())).toEqual(bobBytes);

  // /u/<unknown>/... 404s.
  const phantom = await fetch(`${baseUrl}/u/phantom-user/t/morning/asset/shared-name.png`);
  expect(phantom.status).toBe(404);

  // Legacy /t/<thread>/asset/<file> with collision now 404s (was a leak risk).
  const legacy = await fetch(`${baseUrl}/t/morning/asset/shared-name.png`);
  expect(legacy.status).toBe(404);
});

test("legacy /t/<thread>/asset/<file> still serves single-user (single-tenant compat)", async () => {
  const aliceTok = await pairAs("alice");
  const bytes = new TextEncoder().encode("only-alice");
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256").update(bytes).digest("hex");
  await fetch(`${baseUrl}/v1/sync/assets/${hash}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${aliceTok}`,
      "content-type": "application/octet-stream",
      "x-folio-filename": "solo.png",
      "x-folio-thread-id": "solo-thread",
    },
    body: bytes,
  });
  // No collision → legacy route works.
  const r = await fetch(`${baseUrl}/t/solo-thread/asset/solo.png`);
  expect(r.status).toBe(200);
  expect(new Uint8Array(await r.arrayBuffer())).toEqual(bytes);
  // New route works too.
  const r2 = await fetch(`${baseUrl}/u/alice/t/solo-thread/asset/solo.png`);
  expect(r2.status).toBe(200);
});

test("Bob cannot push live entries against Alice's note", async () => {
  const aliceTok = await pairAs("alice");
  const bobTok = await pairAs("bob");
  const uuid = "01HXALICE-LIVE";
  await push(aliceTok, [{
    uuid,
    slug: "live",
    thread_id: "live",
    title: "Live note",
    type: "journal",
    body_html: "<p>live</p>",
    created_at: "2026-05-15T09:00:00Z",
    live: 1,
    owner_device_id: null,
  }]);

  // Bob tries to spam entries into Alice's live note.
  const r = await fetch(`${baseUrl}/v1/sync/push`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bobTok}`, "content-type": "application/json" },
    body: JSON.stringify({
      live_entries: [{
        id: "01HXBOB-ENTRY",
        note_uuid: uuid,
        ts: "2026-05-15T09:01:00Z",
        content_html: "<p>spam</p>",
      }],
    }),
  });
  expect(r.status).toBe(200);
  const body = (await r.json()) as { live_entries: any[] };
  expect(body.live_entries).toHaveLength(0); // silent skip — owner mismatch
});
