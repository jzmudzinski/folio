import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDb } from "../src/core/db";
import { closeCloudDb } from "../src/cloud/db";

let homeDir: string;
let cloudHomeDir: string;
let server: { stop: () => void; port: number; hostname: string } | null = null;
let token: string;
let baseUrl: string;
let selfDeviceId: string;

beforeEach(async () => {
  homeDir = mkdtempSync(join(tmpdir(), "folio-delete-home-"));
  cloudHomeDir = mkdtempSync(join(tmpdir(), "folio-delete-cloud-"));
  process.env.FOLIO_HOME = homeDir;
  process.env.FOLIO_CLOUD_HOME = cloudHomeDir;
  const { startCloudServer } = await import("../src/cloud/server");
  server = (await startCloudServer({ port: 0 })) as any;
  baseUrl = `http://${server!.hostname}:${server!.port}`;
  const { init } = await import("../src/cli/commands/init");
  await init();
  const { getOrCreateDeviceId } = await import("../src/core/config");
  selfDeviceId = getOrCreateDeviceId().id;
  const { createPairingCode } = await import("../src/cloud/auth");
  const { code } = createPairingCode();
  const pairRes = await fetch(`${baseUrl}/v1/auth/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, device_name: "test", device_id: selfDeviceId }),
  });
  token = ((await pairRes.json()) as { token: string }).token;
  const { saveSyncState } = await import("../src/core/sync");
  saveSyncState({
    remote: baseUrl,
    device_token: token,
    last_pulled_seq: 0,
    last_pushed_at: null,
    last_live_pushed: {},
  });
});

afterEach(() => {
  try { server?.stop(); } catch {}
  server = null;
  closeDb();
  closeCloudDb();
  rmSync(homeDir, { recursive: true, force: true });
  rmSync(cloudHomeDir, { recursive: true, force: true });
  delete process.env.FOLIO_HOME;
  delete process.env.FOLIO_CLOUD_HOME;
});

test("deleteNote: file moved to .trash/, status='trashed', FTS row removed", async () => {
  const { createNote, deleteNote, getNoteMeta } = await import("../src/core/storage");
  const { db } = await import("../src/core/db");

  const note = await createNote({
    type: "snippet",
    title: "To delete",
    body_html: "<p>doomed</p>",
    thread_id: "del-test",
  });
  const filePath = join(homeDir, note.path);
  expect(existsSync(filePath)).toBe(true);

  const res = deleteNote(note.id);
  expect(res.ok).toBe(true);

  // File is gone from original location, trash holds it.
  expect(existsSync(filePath)).toBe(false);
  expect(existsSync(join(homeDir, ".trash", note.id, "note.html"))).toBe(true);

  // DB status flipped; getNoteMeta filters status='active'.
  expect(getNoteMeta(note.id)).toBeNull();
  const row = db()
    .query<{ status: string }, [string]>("SELECT status FROM notes WHERE id = ?")
    .get(note.id);
  expect(row?.status).toBe("trashed");

  // FTS row removed → search doesn't surface it.
  const fts = db()
    .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM notes_fts WHERE id = ?")
    .get(note.id);
  expect(fts?.n).toBe(0);
});

test("deleteNote: unknown id returns not-found", async () => {
  const { deleteNote } = await import("../src/core/storage");
  const res = deleteNote("01HXNONE");
  expect(res.ok).toBe(false);
  expect(res.reason).toBe("not-found");
});

test("deleteNote: live note also archives its .entries.jsonl", async () => {
  const { createNote, deleteNote } = await import("../src/core/storage");
  const { appendEntry, entriesPath } = await import("../src/core/live");

  const note = await createNote({
    type: "journal",
    title: "Doomed live",
    body_html: "<p>chrome</p>",
    thread_id: "del-live",
    live: true,
  });
  const jsonl = entriesPath(join(homeDir, note.path));
  appendEntry(jsonl, { content_html: "<p>entry 1</p>" });
  expect(existsSync(jsonl)).toBe(true);

  deleteNote(note.id);

  expect(existsSync(jsonl)).toBe(false);
  expect(existsSync(join(homeDir, ".trash", note.id, "entries.jsonl"))).toBe(true);
});

test("sync pushes deletion: cloud row removed after local delete + syncOnce", async () => {
  const { createNote, deleteNote } = await import("../src/core/storage");
  const { loadSyncState, syncOnce } = await import("../src/core/sync");
  const { cloudDb } = await import("../src/cloud/db");

  // 1. Create + sync — cloud has the note.
  const note = await createNote({
    type: "snippet",
    title: "Sync then delete",
    body_html: "<p>x</p>",
    thread_id: "sync-del",
  });
  let state = loadSyncState()!;
  await syncOnce(state);

  expect(
    cloudDb()
      .query<{ uuid: string }, [string]>("SELECT uuid FROM notes WHERE uuid = ?")
      .get(note.id)
  ).not.toBeNull();

  // 2. Local delete + sync — cloud row removed.
  deleteNote(note.id);
  state = loadSyncState()!;
  const r = await syncOnce(state);
  expect(r.deleted).toBe(1);

  expect(
    cloudDb()
      .query<{ uuid: string }, [string]>("SELECT uuid FROM notes WHERE uuid = ?")
      .get(note.id)
  ).toBeNull();

  // 3. Re-running sync is idempotent: cursor advanced, nothing to push again.
  const r2 = await syncOnce(state);
  expect(r2.deleted).toBe(0);
});

test("CLI folio delete: happy path with --yes bypasses prompt", async () => {
  const { createNote } = await import("../src/core/storage");
  const { deleteCmd } = await import("../src/cli/commands/delete");

  const note = await createNote({
    type: "snippet",
    title: "Via CLI",
    body_html: "<p>x</p>",
    thread_id: "cli-del",
  });
  const code = await deleteCmd({ id: note.id, yes: true });
  expect(code).toBe(0);

  expect(existsSync(join(homeDir, note.path))).toBe(false);
  expect(existsSync(join(homeDir, ".trash", note.id, "note.html"))).toBe(true);
});

test("cross-device tombstone: foreign device's delete propagates to this device via pull", async () => {
  // Setup: two devices share a cloud. This device pairs as "selfDevice".
  // We simulate device A pushing a note, then DELETING it, then verify
  // this device's pull picks up the tombstone and removes the local copy.
  const { createNote } = await import("../src/core/storage");
  const { loadSyncState, syncOnce } = await import("../src/core/sync");
  const { handlePush } = await import("../src/cloud/sync");
  const { getNoteMeta } = await import("../src/core/storage");

  // Local note from another (foreign) device, simulated by direct cloud push.
  const foreignDeviceId = "01HXOTHER0000000000000000XX";
  const foreignUuid = "01HXTOMB000000000000000A";
  // Both devices share user 'default' in this test (single-tenant case).
  const foreignDevice = {
    id: foreignDeviceId,
    name: "foreign",
    userId: "default",
    pairedAt: "2026-05-13T09:00:00Z",
    lastSeenAt: null,
  } as const;
  handlePush(
    {
      notes: [{
        uuid: foreignUuid,
        slug: "foreign-doomed",
        thread_id: "tombstones",
        title: "Foreign doomed note",
        type: "research",
        body_html: "<p>about to be deleted on the foreign device</p>",
        created_at: "2026-05-13T10:00:00Z",
      }],
    },
    foreignDevice,
  );

  // Pull on this device — note appears locally.
  const state = loadSyncState()!;
  await syncOnce(state);
  expect(getNoteMeta(foreignUuid)).not.toBeNull();
  const localPath = getNoteMeta(foreignUuid)!.path;
  expect(existsSync(join(homeDir, localPath))).toBe(true);

  // Foreign device deletes the note (server-side: hard-DELETE notes row +
  // INSERT tombstone). syncOnce on this device should apply.
  handlePush(
    { deletes: [foreignUuid] },
    foreignDevice,
  );

  const r = await syncOnce(state);
  expect(r.deletes_applied).toBe(1);

  // Local row is gone from active set (getNoteMeta filters status='active').
  expect(getNoteMeta(foreignUuid)).toBeNull();
  // File moved to .trash/<uuid>/note.html — same path as a manual delete.
  expect(existsSync(join(homeDir, ".trash", foreignUuid, "note.html"))).toBe(true);
});

test("tombstone: own-echo skipped (pulling back a delete we initiated)", async () => {
  // Create + sync own note, then delete locally + sync, then sync AGAIN —
  // the tombstone we created on the cloud comes back via pull with
  // origin=self. applyPulledTombstone should skip (file's already trashed
  // locally; double-apply would be a no-op but we want to skip cleanly).
  const { createNote, getNoteMeta, deleteNote } = await import("../src/core/storage");
  const { loadSyncState, syncOnce } = await import("../src/core/sync");

  const note = await createNote({
    type: "snippet",
    title: "Own delete cycle",
    body_html: "<p>x</p>",
    thread_id: "tombstones",
  });
  await syncOnce(loadSyncState()!);

  deleteNote(note.id);
  const r1 = await syncOnce(loadSyncState()!);
  expect(r1.deleted).toBe(1);
  expect(r1.deletes_applied).toBe(0); // own delete, not via tombstone

  // Second sync — the tombstone IS in pull response but origin matches self.
  const r2 = await syncOnce(loadSyncState()!);
  expect(r2.deletes_applied).toBe(0);
  expect(getNoteMeta(note.id)).toBeNull(); // still gone, idempotent
});

test("viewer /api/notes/:id/delete: POST returns deleted + soft-deletes the note", async () => {
  // Spin up a viewer alongside the cloud server (port 0).
  const { writeFileSync, readFileSync } = await import("node:fs");
  const cfgPath = join(homeDir, "folio.config.json");
  const parsed = JSON.parse(readFileSync(cfgPath, "utf-8"));
  parsed.viewer_port = 0;
  writeFileSync(cfgPath, JSON.stringify(parsed));

  const { createNote } = await import("../src/core/storage");
  const note = await createNote({
    type: "snippet",
    title: "via viewer",
    body_html: "<p>x</p>",
    thread_id: "viewer-del",
  });

  const { startServer } = await import("../src/viewer/server");
  const viewer = (await startServer()) as any;
  try {
    const res = await fetch(
      `http://${viewer.hostname}:${viewer.port}/api/notes/${note.id}/delete`,
      { method: "POST" }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: string };
    expect(body.deleted).toBe(note.id);

    // File moved.
    expect(existsSync(join(homeDir, note.path))).toBe(false);
    expect(existsSync(join(homeDir, ".trash", note.id, "note.html"))).toBe(true);

    // Second delete returns 404 (already trashed, getNoteMeta returns null).
    const res2 = await fetch(
      `http://${viewer.hostname}:${viewer.port}/api/notes/${note.id}/delete`,
      { method: "POST" }
    );
    expect(res2.status).toBe(404);
  } finally {
    try { viewer.stop(); } catch {}
  }
});
