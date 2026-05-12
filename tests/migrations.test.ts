// Schema-migration upgrade-path tests.
//
// The regression we're guarding against: v0.9.0 shipped a one-phase
// BASE_SCHEMA that tried to CREATE INDEX notes_by_live ON notes(live, ...)
// during connection open. On a pre-v0.9.0 db (no `live` column yet)
// the index creation raised, crashing the MCP server before the
// migration could ALTER TABLE to add the column. v0.9.1 splits the
// bootstrap into phase1 (meta only) + migrations + phase2 (everything
// else with indexes), so the column exists by the time the index DDL
// runs.

import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { closeDb } from "../src/core/db";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "folio-mig-test-"));
  process.env.FOLIO_HOME = tmpDir;
});

afterEach(() => {
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Stand up a database in the v0.8.0 shape: notes table without `live` or
 * `last_entry_at`, no `notes_by_live` index, meta.schema_version='1'.
 * This is byte-for-byte what an actual pre-v0.9.0 user's index.sqlite
 * looks like.
 */
function makeV080Db(): void {
  const dbFile = join(tmpDir, "index.sqlite");
  const d = new Database(dbFile, { create: true });
  d.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE notes (
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
    CREATE INDEX notes_by_type ON notes(type, created DESC);
    CREATE INDEX notes_by_thread ON notes(thread_id, created DESC);
    CREATE INDEX notes_by_created ON notes(created DESC);
    CREATE INDEX notes_by_expires ON notes(expires_at) WHERE expires_at IS NOT NULL;
    CREATE TABLE tags (
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      PRIMARY KEY (note_id, tag)
    );
    CREATE INDEX tags_by_tag ON tags(tag);
    CREATE VIRTUAL TABLE notes_fts USING fts5(
      id UNINDEXED, title, headings, body, tags,
      tokenize = 'unicode61 remove_diacritics 2'
    );
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL, kind TEXT NOT NULL,
      note_id TEXT, thread_id TEXT, data TEXT
    );
    CREATE INDEX events_by_kind_ts ON events(kind, ts DESC);
    CREATE INDEX events_by_note ON events(note_id, ts DESC);
    INSERT INTO meta (key, value) VALUES ('schema_version', '1');
  `);
  // Seed one note to make sure existing data survives the migration.
  d.run(
    `INSERT INTO notes (id, slug, path, title, type, thread_id, created, updated)
     VALUES ('legacy01', 'legacy-note', 'threads/legacy/legacy-note.html',
             'Legacy note', 'snippet', 'legacy', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
  );
  d.close();
}

// ───── Upgrade path ──────────────────────────────────────────────────────

test("v0.8.0 db survives v0.9.x open without crashing on notes_by_live", async () => {
  makeV080Db();
  // db() is the function that v0.9.0 broke. Calling it on a pre-v0.9.0
  // db should now (v0.9.1) walk phase1 → migration → phase2 cleanly.
  const { db } = await import("../src/core/db");
  expect(() => db()).not.toThrow();
});

test("v0.8.0 db gains live + last_entry_at columns after migration", async () => {
  makeV080Db();
  const { db } = await import("../src/core/db");
  const d = db();
  const cols = d.query<{ name: string }, []>("PRAGMA table_info(notes)").all().map((r) => r.name);
  expect(cols).toContain("live");
  expect(cols).toContain("last_entry_at");
});

test("v0.8.0 db gains notes_by_live index after upgrade", async () => {
  makeV080Db();
  const { db } = await import("../src/core/db");
  const d = db();
  const indexes = d
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='notes'")
    .all()
    .map((r) => r.name);
  expect(indexes).toContain("notes_by_live");
});

test("v0.8.0 db existing rows preserved after upgrade", async () => {
  makeV080Db();
  const { db } = await import("../src/core/db");
  const d = db();
  const row = d.query<any, []>("SELECT id, title, live, last_entry_at FROM notes WHERE id = 'legacy01'").get();
  expect(row?.title).toBe("Legacy note");
  expect(row?.live).toBe(0); // default applied
  expect(row?.last_entry_at).toBeNull();
});

test("v0.8.0 db schema_version bumped to head after migration", async () => {
  makeV080Db();
  const { db } = await import("../src/core/db");
  const d = db();
  const row = d.query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'schema_version'").get();
  expect(row?.value).toBe("2");
});

// ───── Greenfield install path ───────────────────────────────────────────

test("greenfield install: db file created with head schema immediately", async () => {
  // No prior db file — db() must create it from phase1 + phase2 directly.
  expect(existsSync(join(tmpDir, "index.sqlite"))).toBe(false);
  const { db } = await import("../src/core/db");
  const d = db();
  expect(existsSync(join(tmpDir, "index.sqlite"))).toBe(true);
  const cols = d.query<{ name: string }, []>("PRAGMA table_info(notes)").all().map((r) => r.name);
  expect(cols).toContain("live");
  expect(cols).toContain("last_entry_at");
  const indexes = d
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='notes'")
    .all()
    .map((r) => r.name);
  expect(indexes).toContain("notes_by_live");
  const row = d.query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'schema_version'").get();
  expect(row?.value).toBe("2");
});

// ───── Idempotency ───────────────────────────────────────────────────────

test("repeated db() opens are idempotent (cached + no re-migration)", async () => {
  makeV080Db();
  const { db } = await import("../src/core/db");
  const d1 = db();
  const d2 = db();
  expect(d1).toBe(d2); // cached
});

test("close + reopen on already-migrated db is a no-op upgrade", async () => {
  makeV080Db();
  const mod = await import("../src/core/db");
  mod.db(); // first open: applies migration
  mod.closeDb();
  // Reopen — should walk phase1 → migration (no-op, already at head)
  // → phase2 (no-op, everything exists) — no throw.
  expect(() => mod.db()).not.toThrow();
  const d = mod.db();
  const row = d.query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'schema_version'").get();
  expect(row?.value).toBe("2");
});
