/**
 * Cloud relay storage — separate SQLite DB from the local viewer's index.sqlite.
 *
 * Lives at $FOLIO_CLOUD_HOME/cloud.sqlite (default /var/lib/folio-cloud/cloud.sqlite).
 * Schema mirrors the per-device local schema where it makes sense (notes,
 * note_tags, live_entries) but adds device + auth + share tables that have no
 * local counterpart.
 *
 * One database connection per process via singleton. WAL mode for concurrent
 * readers; the push/pull paths are short transactions, so no contention in
 * practice for one-user MVP scale.
 *
 * IMPORTANT: this DB is rebuildable from canonical state, but ONLY if you push
 * all notes from every device again. Treat it as authoritative once it's the
 * sync hub. Backups: bind mount /var/lib/folio-cloud included in VPS snapshot
 * policy, or Litestream → S3/R2 as add-on.
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

export function cloudDataDir(): string {
  return process.env.FOLIO_CLOUD_HOME?.trim() || "/var/lib/folio-cloud";
}

export function cloudDbPath(): string {
  return join(cloudDataDir(), "cloud.sqlite");
}

export function cloudAssetsDir(): string {
  return join(cloudDataDir(), "assets");
}

const CLOUD_SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Paired client devices. One row per laptop/notibox/phone the user pairs.
-- token_hash stores SHA-256 of the bearer token (token itself never persisted).
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,           -- UUIDv7
  name TEXT NOT NULL,            -- user-visible (hostname, "iphone", ...)
  token_hash TEXT NOT NULL,      -- hex sha-256 of bearer token
  paired_at TEXT NOT NULL,       -- ISO 8601
  last_seen_at TEXT,             -- updated on each authed request (throttled)
  revoked_at TEXT                -- null = active; set = denies all requests
);
CREATE INDEX IF NOT EXISTS devices_by_token ON devices(token_hash) WHERE revoked_at IS NULL;

-- One-shot pairing codes printed by the server admin and consumed by a new
-- device. 10 minute TTL. used_by_device_id pins which device claimed the code
-- (idempotent re-pairs return the same device).
CREATE TABLE IF NOT EXISTS pairing_codes (
  code TEXT PRIMARY KEY,         -- 6-digit string, zero-padded
  expires_at TEXT NOT NULL,      -- ISO 8601
  used_by_device_id TEXT         -- null until claimed; set when device pairs
);
CREATE INDEX IF NOT EXISTS pairing_codes_by_exp ON pairing_codes(expires_at);

-- Notes (mirror of local schema, plus origin_device_id for multi-writer).
-- uuid is the cross-device stable identity; slug is a display-only label that
-- may be renamed on conflict.
CREATE TABLE IF NOT EXISTS notes (
  uuid TEXT PRIMARY KEY,         -- UUIDv7, generated client-side at create
  slug TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  theme TEXT NOT NULL DEFAULT 'linen',
  theme_profile TEXT NOT NULL DEFAULT 'hosted',
  body_html TEXT NOT NULL,
  plain_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  is_final INTEGER NOT NULL DEFAULT 0,
  live INTEGER NOT NULL DEFAULT 0,
  owner_device_id TEXT,          -- non-null for live notes only (W2 owner-locked)
  origin_device_id TEXT NOT NULL,
  word_count INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  server_seq INTEGER NOT NULL,   -- monotonic per-row, used for pull cursor
  UNIQUE(thread_id, slug)        -- enforces collision rename at push time
);
CREATE INDEX IF NOT EXISTS notes_by_thread ON notes(thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notes_by_seq ON notes(server_seq);
CREATE INDEX IF NOT EXISTS notes_by_origin ON notes(origin_device_id, server_seq);

CREATE TABLE IF NOT EXISTS note_tags (
  note_uuid TEXT NOT NULL REFERENCES notes(uuid) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (note_uuid, tag)
);
CREATE INDEX IF NOT EXISTS note_tags_by_tag ON note_tags(tag);

-- Live note entries (mirror of local .entries.jsonl, but row-per-entry).
-- Owner-locked at the note level (notes.owner_device_id), so all entries for
-- a given note share the same origin device. server_seq monotonic across all
-- entries cloud-wide (separate from notes.server_seq).
CREATE TABLE IF NOT EXISTS live_entries (
  id TEXT NOT NULL,              -- entry id (8-char ulid from src/core/live.ts)
  note_uuid TEXT NOT NULL REFERENCES notes(uuid) ON DELETE CASCADE,
  ts TEXT NOT NULL,              -- ISO 8601, server-time append
  content_html TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  occurred_at TEXT,              -- optional event time
  refs_json TEXT NOT NULL DEFAULT '[]',
  importance INTEGER,            -- 1..5 or null
  source_ref TEXT,
  server_seq INTEGER NOT NULL,
  PRIMARY KEY (note_uuid, id)    -- dedup is per-note
);
CREATE INDEX IF NOT EXISTS live_entries_by_seq ON live_entries(server_seq);

-- Content-addressed asset storage. hash is SHA-256 hex of bytes; blob_path is
-- relative to cloudAssetsDir() (e.g. "ab/cd/abcd...png" sharded for fs perf).
-- One asset row per unique content hash; thread_id is recorded for backup/
-- export grouping but not enforced as a foreign key — same bytes can be
-- referenced by many threads.
CREATE TABLE IF NOT EXISTS assets (
  hash TEXT PRIMARY KEY,         -- sha256 hex (64 chars)
  filename TEXT NOT NULL,        -- agent-supplied, sanitized by isSafeAssetFilename
  thread_id TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  blob_path TEXT NOT NULL,       -- relative to cloudAssetsDir()
  uploaded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS assets_by_thread ON assets(thread_id);

-- Capability-URL shares (filled in W4; schema-ready in W1).
CREATE TABLE IF NOT EXISTS shares (
  token TEXT PRIMARY KEY,        -- 32-byte url-safe random (43 chars base64url)
  scope_type TEXT NOT NULL,      -- 'note' | 'thread'
  scope_id TEXT NOT NULL,        -- note uuid or thread_id
  created_by_device TEXT NOT NULL REFERENCES devices(id),
  created_at TEXT NOT NULL,
  expires_at TEXT,               -- null = forever
  revoked_at TEXT,
  recipient_email_hash TEXT,     -- optional, hex sha-256(email)
  max_views INTEGER,             -- null = unlimited
  view_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS shares_by_scope ON shares(scope_type, scope_id);
CREATE INDEX IF NOT EXISTS shares_by_expires ON shares(expires_at) WHERE expires_at IS NOT NULL;

-- Server-wide sequence counter. Notes and live_entries draw from this so that
-- a single monotonic int suffices as pull cursor across both. Bumped under
-- transaction at each insert.
CREATE TABLE IF NOT EXISTS server_seq (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  value INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO server_seq (id, value) VALUES (1, 0);
`;

let _db: Database | null = null;

export function cloudDb(): Database {
  if (_db) return _db;
  const dir = cloudDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o755 });
  const dbFile = cloudDbPath();
  if (!existsSync(dirname(dbFile))) mkdirSync(dirname(dbFile), { recursive: true });
  _db = new Database(dbFile, { create: true });
  _db.exec(CLOUD_SCHEMA);
  return _db;
}

export function closeCloudDb(): void {
  _db?.close();
  _db = null;
}

/**
 * Atomically bump and return the next monotonic sequence number. Use this for
 * every notes or live_entries insert so that pull cursors are stable across
 * the union of both tables.
 */
export function nextSeq(db: Database): number {
  const row = db
    .query<{ value: number }, []>("UPDATE server_seq SET value = value + 1 WHERE id = 1 RETURNING value")
    .get();
  if (!row) throw new Error("server_seq row missing — DB not initialized");
  return row.value;
}
