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
  cursor: number;
}

export interface PullPayload {
  notes: PullNote[];
  live_entries: PullLiveEntry[];
  assets: PullAsset[];
  cursor: number;
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

function resolveSlug(db: Database, threadId: string, desiredSlug: string, uuid: string): string {
  // Same uuid → keep slug (idempotent re-push)
  const existing = db
    .query<{ slug: string }, [string]>("SELECT slug FROM notes WHERE uuid = ?")
    .get(uuid);
  if (existing) return existing.slug;
  // Different uuid, same (thread, slug) collision → append uuid6 suffix
  const clash = db
    .query<{ count: number }, [string, string]>(
      "SELECT COUNT(*) AS count FROM notes WHERE thread_id = ? AND slug = ?"
    )
    .get(threadId, desiredSlug);
  if (clash && clash.count > 0) {
    const suffix = uuid.replace(/-/g, "").slice(0, 6);
    return `${desiredSlug}-${suffix}`;
  }
  return desiredSlug;
}

export function handlePush(payload: PushPayload, originDeviceId: string, db: Database = cloudDb()): PushAccepted {
  const accepted: PushAccepted = { notes: [], live_entries: [], deletes: [], cursor: 0 };
  const tx = db.transaction(() => {
    for (const n of payload.notes ?? []) {
      const canonicalSlug = resolveSlug(db, n.thread_id, n.slug, n.uuid);
      const seq = nextSeq(db);
      db.run(
        `INSERT INTO notes (
          uuid, slug, thread_id, title, type, theme, theme_profile,
          body_html, plain_text, created_at, updated_at, expires_at,
          is_final, live, owner_device_id, origin_device_id,
          word_count, summary, server_seq
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    }
    // Deletes are processed last so they don't fight with concurrent pushes
    // of the same uuid (idempotent push then delete = empty after).
    // FK ON DELETE CASCADE on note_tags + live_entries cleans those up.
    // Shares pointing at a deleted scope_id become 404 on next access
    // (validateShareAccess looks up the note); we don't bother revoking
    // them, expiry + TTL handle that.
    for (const uuid of payload.deletes ?? []) {
      const res = db.run("DELETE FROM notes WHERE uuid = ?", [uuid]);
      if ((res.changes ?? 0) > 0) accepted.deletes.push(uuid);
    }
  });
  tx();
  return accepted;
}

export function handlePull(since: number, db: Database = cloudDb()): PullPayload {
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
      [number]
    >(
      `SELECT uuid, slug, thread_id, title, type, theme, theme_profile,
              body_html, plain_text, created_at, updated_at, expires_at,
              is_final, live, owner_device_id, origin_device_id,
              word_count, summary, server_seq
         FROM notes WHERE server_seq > ? ORDER BY server_seq ASC`
    )
    .all(since);

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
      [number]
    >(
      `SELECT id, note_uuid, ts, content_html, tags_json, occurred_at,
              refs_json, importance, source_ref, server_seq
         FROM live_entries WHERE server_seq > ? ORDER BY server_seq ASC`
    )
    .all(since);

  // Assets referenced by the notes in this delta — let the client decide
  // whether to fetch bytes (HEAD/GET /v1/sync/assets/:hash).
  const threadIds = Array.from(new Set(notes.map((n) => n.thread_id)));
  const assets: PullAsset[] = [];
  if (threadIds.length > 0) {
    const placeholders = threadIds.map(() => "?").join(",");
    const rows = db
      .query<
        { hash: string; filename: string; thread_id: string; content_type: string; size_bytes: number },
        string[]
      >(
        `SELECT hash, filename, thread_id, content_type, size_bytes
           FROM assets WHERE thread_id IN (${placeholders})`
      )
      .all(...threadIds);
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

  const maxSeq = Math.max(
    since,
    ...notes.map((n) => n.server_seq),
    ...entries.map((e) => e.server_seq)
  );

  return {
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
  db: Database = cloudDb()
): AssetUploadResult {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== hash) throw new Error("hash mismatch");
  const existing = db
    .query<{ hash: string; size_bytes: number }, [string]>(
      "SELECT hash, size_bytes FROM assets WHERE hash = ?"
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
    `INSERT INTO assets (hash, filename, thread_id, content_type, size_bytes, blob_path, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [hash, filename, threadId, contentType, bytes.byteLength, rel, new Date().toISOString()]
  );
  return { hash, size_bytes: bytes.byteLength, stored: true };
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
