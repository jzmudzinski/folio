import { Database } from "bun:sqlite";
import { dbPath } from "./config";
import { runMigrations, HEAD_VERSION } from "./migrations";

// Greenfield schema. Runs on every connection via CREATE TABLE IF NOT EXISTS,
// so it must always reflect the LATEST schema shape. For existing dbs that
// predate a column addition, see src/core/migrations.ts — that module
// handles version-driven ALTERs that SQLite can't gate with IF NOT EXISTS.
const BASE_SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  theme TEXT NOT NULL DEFAULT 'linen',
  theme_profile TEXT NOT NULL DEFAULT 'hosted',
  thread_id TEXT NOT NULL,
  is_final INTEGER NOT NULL DEFAULT 0,
  created TEXT NOT NULL,
  updated TEXT NOT NULL,
  expires_at TEXT,
  word_count INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  live INTEGER NOT NULL DEFAULT 0,
  last_entry_at TEXT,
  -- W2 multi-writer sync: device id that created the note, and (for live
  -- notes only) the device id allowed to append entries. Both populated by
  -- createNote() and backfilled by migrations.ts v2→v3.
  origin_device_id TEXT,
  owner_device_id TEXT
);
-- notes_by_origin index lives in migrations.ts v2→v3 so it's created AFTER
-- the column is guaranteed to exist on pre-existing dbs.
CREATE INDEX IF NOT EXISTS notes_by_type ON notes(type, created DESC);
CREATE INDEX IF NOT EXISTS notes_by_thread ON notes(thread_id, created DESC);
CREATE INDEX IF NOT EXISTS notes_by_created ON notes(created DESC);
CREATE INDEX IF NOT EXISTS notes_by_expires ON notes(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS notes_by_live ON notes(live, last_entry_at) WHERE live = 1;

CREATE TABLE IF NOT EXISTS tags (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (note_id, tag)
);
CREATE INDEX IF NOT EXISTS tags_by_tag ON tags(tag);

CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  id UNINDEXED,
  title,
  headings,
  body,
  tags,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  kind TEXT NOT NULL,
  note_id TEXT,
  thread_id TEXT,
  data TEXT
);
CREATE INDEX IF NOT EXISTS events_by_kind_ts ON events(kind, ts DESC);
CREATE INDEX IF NOT EXISTS events_by_note ON events(note_id, ts DESC);
`;

let _db: Database | null = null;

export function db(): Database {
  if (_db) return _db;
  _db = new Database(dbPath(), { create: true });
  // Order matters: BASE_SCHEMA first (greenfield install has full latest
  // shape immediately), then migrations to handle pre-existing dbs that
  // were created before a column existed.
  _db.exec(BASE_SCHEMA);
  // Greenfield dbs have no schema_version row yet; pin them to HEAD so the
  // migration loop is a no-op. Pre-existing dbs hit the runMigrations path.
  const row = _db
    .query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'schema_version'")
    .get();
  if (!row) {
    _db.run("INSERT INTO meta (key, value) VALUES ('schema_version', ?)", [HEAD_VERSION]);
  }
  runMigrations(_db);
  return _db;
}

export function closeDb(): void {
  _db?.close();
  _db = null;
}

export function logEvent(
  kind: string,
  data: Record<string, unknown> = {},
  noteId?: string,
  threadId?: string
): void {
  db().run(
    "INSERT INTO events (ts, kind, note_id, thread_id, data) VALUES (?, ?, ?, ?, ?)",
    [new Date().toISOString(), kind, noteId ?? null, threadId ?? null, JSON.stringify(data)]
  );
}
