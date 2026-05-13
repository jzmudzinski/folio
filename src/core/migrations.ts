// Schema migration framework.
//
// db.ts runs BASE_SCHEMA on every connection (CREATE TABLE IF NOT EXISTS …)
// for greenfield installs. This module handles version-driven schema
// evolution on existing databases — additive ALTER TABLEs that SQLite
// doesn't support via IF NOT EXISTS.
//
// Pattern: each migration has {from, to, up}. Runner reads
// meta.schema_version, applies any migration whose `from` matches the
// current version, bumps to `to`, repeats until no migration applies.
// Migrations must be idempotent (use PRAGMA table_info to check before
// ALTER) so a partial run + re-run still converges.
//
// Adding a new schema change: append a new Migration to MIGRATIONS.
// Never edit a shipped migration's `up` — write a new one.

import type { Database } from "bun:sqlite";

export interface Migration {
  /** Current schema_version this migration applies to (string). */
  from: string;
  /** schema_version after `up` runs successfully. */
  to: string;
  /** What changed and why — surfaces in commit/PR review and migration log. */
  description: string;
  /** Idempotent DDL/DML. Must be safe to re-run on a partially-migrated db. */
  up: (db: Database) => void;
}

/**
 * Check whether the `notes` table already has a given column.
 * SQLite has no `ALTER TABLE ADD COLUMN IF NOT EXISTS`, so migrations
 * gate ALTER on this.
 */
function hasColumn(db: Database, table: string, column: string): boolean {
  const rows = db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all();
  return rows.some((r) => r.name === column);
}

export const MIGRATIONS: Migration[] = [
  {
    from: "1",
    to: "2",
    description: "Add live + last_entry_at columns to notes (v0.9.0 live notes primitive)",
    up: (db) => {
      if (!hasColumn(db, "notes", "live")) {
        db.exec("ALTER TABLE notes ADD COLUMN live INTEGER NOT NULL DEFAULT 0");
      }
      if (!hasColumn(db, "notes", "last_entry_at")) {
        db.exec("ALTER TABLE notes ADD COLUMN last_entry_at TEXT");
      }
    },
  },
  {
    from: "2",
    to: "3",
    description:
      "Add origin_device_id + owner_device_id columns to notes (multi-writer sync, W2). " +
      "origin_device_id tracks which device created the note (skip own-echo on pull); " +
      "owner_device_id is set for live notes only and gates append_entry to that device.",
    up: (db) => {
      if (!hasColumn(db, "notes", "origin_device_id")) {
        db.exec("ALTER TABLE notes ADD COLUMN origin_device_id TEXT");
      }
      if (!hasColumn(db, "notes", "owner_device_id")) {
        db.exec("ALTER TABLE notes ADD COLUMN owner_device_id TEXT");
      }
      // Backfill: existing notes were created on this device (nobody else
      // had access to ~/Folio/ prior to W2 sync). Live notes also get
      // owner_device_id = self so append_entry continues to work for them.
      // We do this BEFORE the cli/cloud paths fill in via getOrCreateDeviceId,
      // so we resolve device id here too (sync, same source of truth).
      const { getOrCreateDeviceId } = require("./config") as typeof import("./config");
      const dev = getOrCreateDeviceId();
      db.run("UPDATE notes SET origin_device_id = ? WHERE origin_device_id IS NULL", [dev.id]);
      db.run("UPDATE notes SET owner_device_id = ? WHERE live = 1 AND owner_device_id IS NULL", [dev.id]);
    },
  },
];

/**
 * Apply any pending migrations. Called from db() on connection open,
 * AFTER BASE_SCHEMA runs (so freshly-created tables have the latest shape;
 * migrations only fire on existing dbs that were created before this code).
 */
export function runMigrations(db: Database): void {
  // Ensure meta has a schema_version row. Greenfield: BASE_SCHEMA created
  // notes with the latest columns, so we can jump straight to the head
  // version. Pre-existing dbs without meta row are treated as version "1".
  let current = db
    .query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'schema_version'")
    .get()?.value;

  if (!current) {
    // Existing db (pre-v0.9.0) that ran on the old code path — its
    // `notes` table may already have `live` if the user is running this
    // upgraded code on a fresh box. Either way, start the loop at "1"
    // and let the migration's hasColumn guard do the right thing.
    db.run("INSERT INTO meta (key, value) VALUES ('schema_version', '1')");
    current = "1";
  }

  // Apply migrations greedily until no match.
  // Cap iterations so a misconfigured migration ring doesn't loop forever.
  let safety = MIGRATIONS.length + 1;
  while (safety-- > 0) {
    const m = MIGRATIONS.find((mig) => mig.from === current);
    if (!m) break;
    m.up(db);
    db.run("UPDATE meta SET value = ? WHERE key = 'schema_version'", [m.to]);
    current = m.to;
  }
}

/**
 * Head version. Used by db.ts after running BASE_SCHEMA on a brand-new db
 * so we don't pointlessly invoke migrations on a table that was just
 * created with the head shape.
 */
export const HEAD_VERSION = MIGRATIONS.length > 0 ? MIGRATIONS[MIGRATIONS.length - 1]!.to : "1";
