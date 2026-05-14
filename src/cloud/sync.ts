/**
 * Sync surface — push/pull payload shapes + handlers, plus asset upload.
 *
 * Push response includes a rename map: if a note's (thread_id, slug) collided
 * with an existing row, the server saves it under `<slug>-<uuid6>.html` shape
 * (slug-only — the cloud doesn't write files, the client does) and returns
 * the canonical slug so the client renames locally. URL `/n/<uuid>` is
 * stable regardless of rename, because uuid is the cross-device identity.
 *
 * Pull returns a delta keyed by `server_seq`. Both notes and live_entries
 * draw from the same monotonic counter (see db.ts nextSeq), so one cursor
 * suffices for the union.
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { cloudDb, cloudAssetsDir, nextSeq } from "./db";
import { publish as publishLiveEntry } from "./sse-hub";
import type { Device } from "./auth";

export interface PushNote {
  uuid: string;
  slug: string;
  thread_id: string;
  title: string;
  type: string;
  theme?: string;
  theme_profile?: string;
  body_html: string;
  plain_text?: string;
  created_at: string;
  updated_at?: string;
  expires_at?: string | null;
  is_final?: 0 | 1;
  live?: 0 | 1;
  owner_device_id?: string | null;
  tags?: string[];
  summary?: string | null;
  word_count?: number;
}

export interface PushLiveEntry {
  id: string;
  note_uuid: string;
  ts: string;
  content_html: string;
  tags?: string[];
  occurred_at?: string | null;
  refs?: string[];
  importance?: number | null;
  source_ref?: string | null;
}

export interface PushPayload {
  notes?: PushNote[];
  live_entries?: PushLiveEntry[];
  /** UUIDs to delete. Cascade drops note_tags + live_entries. Idempotent —
   *  re-sending uuids that no longer exist is a silent no-op. */
  deletes?: string[];
}

export interface PushAccepted {
  notes: { uuid: string; canonical_slug: string }[];
  live_entries: { id: string; note_uuid: string }[];
  deletes: string[];
  /** Count of asset blobs hard-deleted as orphans (no remaining note
   *  references them). Surfaces in the response so operators can see
   *  storage being reclaimed; not part of cursor advance. */
  assets_deleted: number;
  cursor: number;
}

export interface PullPayload {
  notes: PullNote[];
  live_entries: PullLiveEntry[];
  tombstones: PullTombstone[];
  assets: PullAsset[];
  cursor: number;
}

export interface PullTombstone {
  uuid: string;
  thread_id: string;
  origin_device_id: string | null;
  deleted_at: string;
  server_seq: number;
}

export interface PullNote {
  uuid: string;
  slug: string;
  thread_id: string;
  title: string;
  type: string;
  theme: string;
  theme_profile: string;
  body_html: string;
  plain_text: string;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  is_final: 0 | 1;
  live: 0 | 1;
  owner_device_id: string | null;
  origin_device_id: string;
  tags: string[];
  summary: string | null;
  word_count: number;
  server_seq: number;
}

export interface PullLiveEntry {
  id: string;
  note_uuid: string;
  ts: string;
  content_html: string;
  tags: string[];
  occurred_at: string | null;
  refs: string[];
  importance: number | null;
  source_ref: string | null;
  server_seq: number;
}

export interface PullAsset {
  hash: string;
  filename: string;
  thread_id: string;
  content_type: string;
  size_bytes: number;
}

function resolveSlug(db: Database, userId: string, threadId: string, desiredSlug: string, uuid: string): string {
  // Same uuid → keep slug (idempotent re-push). Same-uuid checked WITHOUT
  // user_id scope first so an attempt to "steal" another user's uuid via
  // a duplicate push lands as a unique constraint failure on the upsert
  // path below rather than silently rebinding.
  const existing = db
    .query<{ slug: string; user_id: string }, [string]>("SELECT slug, user_id FROM notes WHERE uuid = ?")
    .get(uuid);
  if (existing) {
    if (existing.user_id !== userId) {
      throw new Error(`note ${uuid} belongs to a different user`);
    }
    return existing.slug;
  }
  // Different uuid, same (user_id, thread, slug) collision → append uuid6 suffix.
  // Two users can both have (thread="morning", slug="alpha") side-by-side now.
  const clash = db
    .query<{ count: number }, [string, string, string]>(
      "SELECT COUNT(*) AS count FROM notes WHERE user_id = ? AND thread_id = ? AND slug = ?"
    )
    .get(userId, threadId, desiredSlug);
  if (clash && clash.count > 0) {
    const suffix = uuid.replace(/-/g, "").slice(0, 6);
    return `${desiredSlug}-${suffix}`;
  }
  return desiredSlug;
}

export function handlePush(payload: PushPayload, device: Device, db: Database = cloudDb()): PushAccepted {
  const accepted: PushAccepted = { notes: [], live_entries: [], deletes: [], assets_deleted: 0, cursor: 0 };
  const originDeviceId = device.id;
  const userId = device.userId;
  const tx = db.transaction(() => {
    for (const n of payload.notes ?? []) {
      const canonicalSlug = resolveSlug(db, userId, n.thread_id, n.slug, n.uuid);
      const seq = nextSeq(db);
      db.run(
        `INSERT INTO notes (
          uuid, user_id, slug, thread_id, title, type, theme, theme_profile,
          body_html, plain_text, created_at, updated_at, expires_at,
          is_final, live, owner_device_id, origin_device_id,
          word_count, summary, server_seq
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(uuid) DO UPDATE SET
          slug = excluded.slug,
          thread_id = excluded.thread_id,
          title = excluded.title,
          type = excluded.type,
          theme = excluded.theme,
          theme_profile = excluded.theme_profile,
          body_html = excluded.body_html,
          plain_text = excluded.plain_text,
          updated_at = excluded.updated_at,
          expires_at = excluded.expires_at,
          is_final = excluded.is_final,
          live = excluded.live,
          owner_device_id = excluded.owner_device_id,
          word_count = excluded.word_count,
          summary = excluded.summary,
          server_seq = excluded.server_seq`,
        [
          n.uuid,
          userId,
          canonicalSlug,
          n.thread_id,
          n.title,
          n.type,
          n.theme ?? "linen",
          n.theme_profile ?? "hosted",
          n.body_html,
          n.plain_text ?? "",
          n.created_at,
          n.updated_at ?? n.created_at,
          n.expires_at ?? null,
          n.is_final ?? 0,
          n.live ?? 0,
          n.owner_device_id ?? null,
          originDeviceId,
          n.word_count ?? 0,
          n.summary ?? null,
          seq,
        ]
      );
      // Replace tag set (simpler than diffing). Cascades on note delete.
      db.run("DELETE FROM note_tags WHERE note_uuid = ?", [n.uuid]);
      for (const tag of n.tags ?? []) {
        db.run("INSERT OR IGNORE INTO note_tags (note_uuid, tag) VALUES (?, ?)", [n.uuid, tag]);
      }
      accepted.notes.push({ uuid: n.uuid, canonical_slug: canonicalSlug });
      accepted.cursor = Math.max(accepted.cursor, seq);
    }
    for (const e of payload.live_entries ?? []) {
      // Owner check: live entries can only be appended to a note owned by
      // the same user. Without this, anyone authed could spam entries into
      // any user's live notes. Skip silently if the parent note doesn't
      // exist OR belongs to a different user — keep idempotency semantics
      // (a re-push of historical entries after the parent was deleted is
      // a no-op, not an error).
      const parent = db
        .query<{ user_id: string }, [string]>("SELECT user_id FROM notes WHERE uuid = ?")
        .get(e.note_uuid);
      if (!parent || parent.user_id !== userId) continue;
      const seq = nextSeq(db);
      db.run(
        `INSERT INTO live_entries (
          id, note_uuid, ts, content_html, tags_json, occurred_at,
          refs_json, importance, source_ref, server_seq
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(note_uuid, id) DO NOTHING`,
        [
          e.id,
          e.note_uuid,
          e.ts,
          e.content_html,
          JSON.stringify(e.tags ?? []),
          e.occurred_at ?? null,
          JSON.stringify(e.refs ?? []),
          e.importance ?? null,
          e.source_ref ?? null,
          seq,
        ]
      );
      accepted.live_entries.push({ id: e.id, note_uuid: e.note_uuid });
      accepted.cursor = Math.max(accepted.cursor, seq);
      // Fan out to any /v1/sync/live-stream subscribers on this note.
      // No-op if nobody's listening, so safe to call unconditionally.
      publishLiveEntry(e.note_uuid, {
        id: e.id,
        note_uuid: e.note_uuid,
        ts: e.ts,
        content_html: e.content_html,
        tags: e.tags ?? [],
        occurred_at: e.occurred_at ?? null,
        refs: e.refs ?? [],
        importance: e.importance ?? null,
        source_ref: e.source_ref ?? null,
      });
    }
    // Deletes are processed last so they don't fight with concurrent pushes
    // of the same uuid (idempotent push then delete = empty after).
    // FK ON DELETE CASCADE on note_tags + live_entries cleans those up.
    // We also insert a tombstone row so other devices learn about this
    // delete via pull — without tombstones the deleted note simply
    // disappears from the active-notes window and pull silently misses it.
    // Shares pointing at a deleted scope_id become 404 on next access
    // (validateShareAccess looks up the note); we don't bother revoking
    // them, expiry + TTL handle that.
    for (const uuid of payload.deletes ?? []) {
      // Look up user_id + thread_id + origin + body BEFORE deleting:
      //   - user_id: ownership check — only the owning user may delete
      //   - thread_id + origin: needed for the tombstone metadata
      //   - body_html: needed to extract asset refs so we can GC any
      //     orphan blobs (assets that were only referenced by this note)
      const meta = db
        .query<{ user_id: string; thread_id: string; origin_device_id: string | null; body_html: string }, [string]>(
          "SELECT user_id, thread_id, origin_device_id, body_html FROM notes WHERE uuid = ?"
        )
        .get(uuid);
      if (!meta) continue; // unknown uuid → idempotent no-op (matches v0.12)
      if (meta.user_id !== userId) {
        // Cross-user delete attempt. Skip silently rather than error out
        // — one bad uuid in a batch shouldn't fail the whole push.
        continue;
      }
      const res = db.run("DELETE FROM notes WHERE uuid = ? AND user_id = ?", [uuid, userId]);
      if ((res.changes ?? 0) > 0) {
        accepted.deletes.push(uuid);
        const seq = nextSeq(db);
        db.run(
          `INSERT INTO tombstones (uuid, user_id, thread_id, origin_device_id, deleted_at, server_seq)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(uuid) DO UPDATE SET
             user_id = excluded.user_id,
             thread_id = excluded.thread_id,
             origin_device_id = excluded.origin_device_id,
             deleted_at = excluded.deleted_at,
             server_seq = excluded.server_seq`,
          [
            uuid,
            userId,
            meta.thread_id,
            meta.origin_device_id ?? originDeviceId,
            new Date().toISOString(),
            seq,
          ]
        );
        accepted.cursor = Math.max(accepted.cursor, seq);

        // Asset orphan cleanup, scoped to this user. For each (thread,
        // filename) referenced by the doomed note, check if any of this
        // user's remaining active notes still cite it (LIKE scan on body_html
        // filtered by user_id). Zero same-user references → unlink blob +
        // delete the assets row. Cross-user assets that happen to share a
        // (thread, filename) name aren't touched.
        if (meta.body_html) {
          accepted.assets_deleted += sweepOrphanAssetsFor(meta.body_html, userId, db);
        }
      }
    }
  });
  tx();
  return accepted;
}

export function handlePull(since: number, device: Device, db: Database = cloudDb()): PullPayload {
  const userId = device.userId;
  const notes = db
    .query<
      {
        uuid: string;
        slug: string;
        thread_id: string;
        title: string;
        type: string;
        theme: string;
        theme_profile: string;
        body_html: string;
        plain_text: string;
        created_at: string;
        updated_at: string;
        expires_at: string | null;
        is_final: number;
        live: number;
        owner_device_id: string | null;
        origin_device_id: string;
        word_count: number;
        summary: string | null;
        server_seq: number;
      },
      [string, number]
    >(
      `SELECT uuid, slug, thread_id, title, type, theme, theme_profile,
              body_html, plain_text, created_at, updated_at, expires_at,
              is_final, live, owner_device_id, origin_device_id,
              word_count, summary, server_seq
         FROM notes WHERE user_id = ? AND server_seq > ? ORDER BY server_seq ASC`
    )
    .all(userId, since);

  // Live entries: scope via parent-note's user_id (entries don't carry their
  // own user_id, only inherited from notes). Sub-select keeps the cursor
  // semantics intact across the union.
  const entries = db
    .query<
      {
        id: string;
        note_uuid: string;
        ts: string;
        content_html: string;
        tags_json: string;
        occurred_at: string | null;
        refs_json: string;
        importance: number | null;
        source_ref: string | null;
        server_seq: number;
      },
      [number, string]
    >(
      `SELECT le.id, le.note_uuid, le.ts, le.content_html, le.tags_json, le.occurred_at,
              le.refs_json, le.importance, le.source_ref, le.server_seq
         FROM live_entries le
         INNER JOIN notes n ON n.uuid = le.note_uuid
        WHERE le.server_seq > ? AND n.user_id = ?
        ORDER BY le.server_seq ASC`
    )
    .all(since, userId);

  // Assets referenced by the notes in this delta — let the client decide
  // whether to fetch bytes (HEAD/GET /v1/sync/assets/:hash). Scoped to user.
  const threadIds = Array.from(new Set(notes.map((n) => n.thread_id)));
  const assets: PullAsset[] = [];
  if (threadIds.length > 0) {
    const placeholders = threadIds.map(() => "?").join(",");
    const rows = db
      .query<
        { hash: string; filename: string; thread_id: string; content_type: string; size_bytes: number },
        any[]
      >(
        `SELECT hash, filename, thread_id, content_type, size_bytes
           FROM assets WHERE user_id = ? AND thread_id IN (${placeholders})`
      )
      .all(userId, ...threadIds);
    for (const r of rows) assets.push(r);
  }

  const tagsByNote = new Map<string, string[]>();
  for (const n of notes) tagsByNote.set(n.uuid, []);
  if (notes.length > 0) {
    const placeholders = notes.map(() => "?").join(",");
    const rows = db
      .query<{ note_uuid: string; tag: string }, string[]>(
        `SELECT note_uuid, tag FROM note_tags WHERE note_uuid IN (${placeholders})`
      )
      .all(...notes.map((n) => n.uuid));
    for (const r of rows) tagsByNote.get(r.note_uuid)?.push(r.tag);
  }

  // Tombstones since cursor — cross-device delete propagation, user-scoped.
  const tombstones: PullTombstone[] = db
    .query<
      {
        uuid: string;
        thread_id: string;
        origin_device_id: string | null;
        deleted_at: string;
        server_seq: number;
      },
      [string, number]
    >(
      `SELECT uuid, thread_id, origin_device_id, deleted_at, server_seq
         FROM tombstones WHERE user_id = ? AND server_seq > ? ORDER BY server_seq ASC`
    )
    .all(userId, since);

  const maxSeq = Math.max(
    since,
    ...notes.map((n) => n.server_seq),
    ...entries.map((e) => e.server_seq),
    ...tombstones.map((t) => t.server_seq)
  );

  return {
    tombstones,
    notes: notes.map((n) => ({
      uuid: n.uuid,
      slug: n.slug,
      thread_id: n.thread_id,
      title: n.title,
      type: n.type,
      theme: n.theme,
      theme_profile: n.theme_profile,
      body_html: n.body_html,
      plain_text: n.plain_text,
      created_at: n.created_at,
      updated_at: n.updated_at,
      expires_at: n.expires_at,
      is_final: (n.is_final as 0 | 1),
      live: (n.live as 0 | 1),
      owner_device_id: n.owner_device_id,
      origin_device_id: n.origin_device_id,
      tags: tagsByNote.get(n.uuid) ?? [],
      summary: n.summary,
      word_count: n.word_count,
      server_seq: n.server_seq,
    })),
    live_entries: entries.map((e) => ({
      id: e.id,
      note_uuid: e.note_uuid,
      ts: e.ts,
      content_html: e.content_html,
      tags: safeJsonArray(e.tags_json),
      occurred_at: e.occurred_at,
      refs: safeJsonArray(e.refs_json),
      importance: e.importance,
      source_ref: e.source_ref,
      server_seq: e.server_seq,
    })),
    assets,
    cursor: maxSeq,
  };
}

function safeJsonArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

const ASSET_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  mp4: "video/mp4",
};

export function assetMimeForFilename(filename: string): string | null {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return null;
  return ASSET_MIME[filename.slice(dot + 1).toLowerCase()] ?? null;
}

/** Sharded path under cloudAssetsDir(): ab/cd/abcd...ext */
export function assetBlobPath(hash: string, filename: string): string {
  const dot = filename.lastIndexOf(".");
  const ext = dot >= 0 ? filename.slice(dot) : "";
  return join(hash.slice(0, 2), hash.slice(2, 4), `${hash}${ext}`);
}

export interface AssetUploadResult {
  hash: string;
  size_bytes: number;
  stored: boolean; // false if already existed (idempotent)
}

/**
 * Accept a binary asset upload. Caller supplies the expected hash in URL;
 * we recompute and reject on mismatch. Filename + thread_id come from
 * headers / query params (validated server-side).
 */
export function storeAsset(
  hash: string,
  filename: string,
  threadId: string,
  bytes: Uint8Array,
  userId: string = "default",
  db: Database = cloudDb()
): AssetUploadResult {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== hash) throw new Error("hash mismatch");
  // assets are content-addressed; same bytes from a different user dedupe to
  // the existing row. The owning user_id is whoever uploaded first — which
  // is fine for the 3-user case (no cross-user collisions in practice). If
  // dedup-with-refcount becomes a real need, swap to (hash, user_id) PK.
  const existing = db
    .query<{ hash: string; size_bytes: number; user_id: string }, [string]>(
      "SELECT hash, size_bytes, user_id FROM assets WHERE hash = ?"
    )
    .get(hash);
  if (existing) return { hash, size_bytes: existing.size_bytes, stored: false };
  const contentType = assetMimeForFilename(filename);
  if (!contentType) throw new Error("unsupported asset type");
  const rel = assetBlobPath(hash, filename);
  const abs = join(cloudAssetsDir(), rel);
  if (!existsSync(dirname(abs))) mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, bytes);
  db.run(
    `INSERT INTO assets (hash, filename, thread_id, user_id, content_type, size_bytes, blob_path, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [hash, filename, threadId, userId, contentType, bytes.byteLength, rel, new Date().toISOString()]
  );
  return { hash, size_bytes: bytes.byteLength, stored: true };
}

/**
 * Sweep orphan assets referenced by `bodyHtml` (the body of a just-deleted
 * note). For each (thread_id, filename) cited there, check if any remaining
 * active note's body still references the same path. Zero references →
 * unlink the blob file + remove the assets row.
 *
 * Idempotent and safe: if the same body's been deleted twice, the second
 * pass finds the asset rows already gone and no-ops. LIKE scan cost is
 * O(n_assets × n_notes); fine at MVP scale (~hundreds of each). If the
 * deck ever grows past ~10k of either, replace with a per-asset refcount
 * column maintained on push.
 */
function sweepOrphanAssetsFor(bodyHtml: string, userId: string, db: Database): number {
  // Same regex as core/sync.ts extractAssetRefs — duplicated locally to
  // avoid pulling in core's full module graph. If the pattern changes,
  // update both call sites.
  const re = /(?:href|src)\s*=\s*["']([^"']*)\/t\/([^/"']+)\/asset\/([^"'?#]+)["']/g;
  const seen = new Set<string>();
  const refs: Array<{ thread_id: string; filename: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(bodyHtml)) !== null) {
    const thread_id = decodeURIComponent(m[2]!);
    const filename = decodeURIComponent(m[3]!);
    const key = `${thread_id}/${filename}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ thread_id, filename });
  }
  if (refs.length === 0) return 0;

  let deleted = 0;
  for (const r of refs) {
    // Cheap escape for LIKE (% and _ are wildcards; the filename comes from
    // body_html which sanitize-html already vetted, but defense in depth).
    const fnSafe = r.filename.replace(/[\\%_]/g, "\\$&");
    const trSafe = r.thread_id.replace(/[\\%_]/g, "\\$&");
    const needle = `%/t/${trSafe}/asset/${fnSafe}%`;
    // ESCAPE '\' — SQLite requires a single-character escape; JS double-
    // backslash unescapes to one in the SQL string. Matches the convention
    // already used in cloud/server.ts /v1/feed query escaping.
    // Scope to this user — another user's note referencing the same
    // (thread, filename) string shouldn't keep our blob alive (their copy
    // has its own row + blob_path even when bytes happen to match).
    const stillRef = db
      .query<{ n: number }, [string, string]>(
        "SELECT COUNT(*) AS n FROM notes WHERE user_id = ? AND body_html LIKE ? ESCAPE '\\'"
      )
      .get(userId, needle);
    if (stillRef && stillRef.n > 0) continue; // someone else (same user) still uses it

    // Orphan. Pull the row to get the blob_path, unlink, then delete.
    // Scope to user_id — never touch another user's asset row, even if it
    // matches the same (thread, filename) tuple by coincidence.
    const asset = db
      .query<{ hash: string; blob_path: string }, [string, string, string]>(
        "SELECT hash, blob_path FROM assets WHERE user_id = ? AND thread_id = ? AND filename = ?"
      )
      .get(userId, r.thread_id, r.filename);
    if (!asset) continue;
    const abs = join(cloudAssetsDir(), asset.blob_path);
    try {
      if (existsSync(abs)) require("node:fs").unlinkSync(abs);
    } catch {
      // Best effort. If unlink fails the DB row still goes away; orphan
      // bytes are scary to keep around vs accepted as one-off leak.
    }
    db.run("DELETE FROM assets WHERE hash = ?", [asset.hash]);
    deleted++;
  }
  return deleted;
}

export function readAsset(hash: string, db: Database = cloudDb()):
  | { bytes: Uint8Array; content_type: string; size_bytes: number }
  | null {
  const row = db
    .query<{ blob_path: string; content_type: string; size_bytes: number }, [string]>(
      "SELECT blob_path, content_type, size_bytes FROM assets WHERE hash = ?"
    )
    .get(hash);
  if (!row) return null;
  const abs = join(cloudAssetsDir(), row.blob_path);
  if (!existsSync(abs)) return null;
  return {
    bytes: new Uint8Array(readFileSync(abs)),
    content_type: row.content_type,
    size_bytes: row.size_bytes,
  };
}
