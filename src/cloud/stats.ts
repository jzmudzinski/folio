/**
 * Admin stats for the cloud relay — a single read-only snapshot useful for
 * observability without standing up a Prometheus exporter. Returned by
 * GET /v1/admin/stats (authed); displayed in the local viewer's /cloud page
 * once paired. Counts, storage bytes, per-device activity, top threads.
 *
 * Cost: each call hits the DB with ~8 lightweight SELECTs and one statSync
 * on cloud.sqlite. Fine to expose at every page load; the local /cloud page
 * fetches once and shows the snapshot inline. Add a cache only if a usage
 * pattern emerges that requires it.
 */

import { statSync } from "node:fs";
import { cloudDb, cloudDbPath } from "./db";
import pkg from "../../package.json" with { type: "json" };

export interface AdminStats {
  cloud: { name: string; version: string; public_url: string };
  counts: {
    notes: number;
    notes_live: number;
    notes_final: number;
    live_entries: number;
    assets: number;
    shares_active: number;
    shares_total: number;
    devices_active: number;
    devices_revoked: number;
    tombstones: number;
  };
  storage: { db_bytes: number; assets_bytes: number };
  devices: Array<{
    id: string;
    name: string;
    paired_at: string;
    last_seen_at: string | null;
    last_pushed_at: string | null;
    revoked: boolean;
    note_count: number;
  }>;
  threads: Array<{ thread_id: string; count: number; latest: string }>;
}

export function buildAdminStats(publicUrl: string): AdminStats {
  const db = cloudDb();

  const single = <T extends Record<string, unknown>>(sql: string): T =>
    (db.query<T, []>(sql).get() ?? ({} as T));

  const c = {
    notes: single<{ n: number }>("SELECT COUNT(*) AS n FROM notes").n ?? 0,
    notes_live: single<{ n: number }>("SELECT COUNT(*) AS n FROM notes WHERE live = 1").n ?? 0,
    notes_final: single<{ n: number }>("SELECT COUNT(*) AS n FROM notes WHERE is_final = 1").n ?? 0,
    live_entries: single<{ n: number }>("SELECT COUNT(*) AS n FROM live_entries").n ?? 0,
    assets: single<{ n: number }>("SELECT COUNT(*) AS n FROM assets").n ?? 0,
    shares_active: single<{ n: number }>(
      "SELECT COUNT(*) AS n FROM shares WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > datetime('now'))"
    ).n ?? 0,
    shares_total: single<{ n: number }>("SELECT COUNT(*) AS n FROM shares").n ?? 0,
    devices_active: single<{ n: number }>("SELECT COUNT(*) AS n FROM devices WHERE revoked_at IS NULL").n ?? 0,
    devices_revoked: single<{ n: number }>("SELECT COUNT(*) AS n FROM devices WHERE revoked_at IS NOT NULL").n ?? 0,
    tombstones: single<{ n: number }>("SELECT COUNT(*) AS n FROM tombstones").n ?? 0,
  };

  let dbBytes = 0;
  try { dbBytes = statSync(cloudDbPath()).size; } catch {}
  const assetsBytes = single<{ s: number | null }>("SELECT SUM(size_bytes) AS s FROM assets").s ?? 0;

  const devices = db
    .query<
      {
        id: string;
        name: string;
        paired_at: string;
        last_seen_at: string | null;
        revoked_at: string | null;
        note_count: number;
        last_pushed_at: string | null;
      },
      []
    >(
      `SELECT d.id, d.name, d.paired_at, d.last_seen_at, d.revoked_at,
              (SELECT COUNT(*) FROM notes WHERE origin_device_id = d.id) AS note_count,
              (SELECT MAX(updated_at) FROM notes WHERE origin_device_id = d.id) AS last_pushed_at
         FROM devices d
        ORDER BY (d.last_seen_at IS NULL), d.last_seen_at DESC, d.paired_at DESC`
    )
    .all()
    .map((r) => ({
      id: r.id,
      name: r.name,
      paired_at: r.paired_at,
      last_seen_at: r.last_seen_at,
      last_pushed_at: r.last_pushed_at,
      revoked: r.revoked_at !== null,
      note_count: r.note_count ?? 0,
    }));

  const threads = db
    .query<{ thread_id: string; count: number; latest: string }, []>(
      `SELECT thread_id, COUNT(*) AS count, MAX(created_at) AS latest
         FROM notes GROUP BY thread_id ORDER BY latest DESC LIMIT 20`
    )
    .all();

  return {
    cloud: { name: "folio-cloud", version: pkg.version, public_url: publicUrl },
    counts: c,
    storage: { db_bytes: dbBytes, assets_bytes: assetsBytes },
    devices,
    threads,
  };
}
