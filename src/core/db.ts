import { Database } from "bun:sqlite";
import { dbPath } from "./config";

const SCHEMA_V1 = `
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
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS notes_by_type ON notes(type, created DESC);
CREATE INDEX IF NOT EXISTS notes_by_thread ON notes(thread_id, created DESC);
CREATE INDEX IF NOT EXISTS notes_by_created ON notes(created DESC);
CREATE INDEX IF NOT EXISTS notes_by_expires ON notes(expires_at) WHERE expires_at IS NOT NULL;

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
  applyMigrations(_db);
  return _db;
}

export function closeDb(): void {
  _db?.close();
  _db = null;
}

function applyMigrations(d: Database): void {
  d.exec(SCHEMA_V1);
  const row = d.query<{ value: string }, []>(
    "SELECT value FROM meta WHERE key = 'schema_version'"
  ).get();
  if (!row) {
    d.run("INSERT INTO meta (key, value) VALUES ('schema_version', '1')");
  }
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
