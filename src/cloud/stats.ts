/**
 * Admin stats for the cloud relay — a single read-only snapshot useful for
 * observability without standing up a Prometheus exporter. Returned by
 * GET /v1/admin/stats (authed); displayed in the local viewer's /cloud page
 * once paired. Counts, storage bytes, per-device activity, top threads.
 *
 * Two callers:
 *   - HTTP route (authed device): `buildAdminStats(publicUrl, userId)` —
 *     scopes every count to the caller's user. Other users are invisible.
 *   - Operator CLI (`folio cloud user-list`): `buildGlobalStats(publicUrl)` —
 *     no user filter, returns whole-cloud aggregates plus a per-user table.
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
  user_id: string;
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

export interface GlobalStats {
  cloud: { name: string; version: string; public_url: string };
  storage: { db_bytes: number };
  users: Array<{
    id: string;
    display_name: string;
    is_operator: boolean;
    created_at: string;
    deleted_at: string | null;
    devices: number;
    devices_revoked: number;
    notes: number;
    live_entries: number;
    assets: number;
    assets_bytes: number;
    shares_active: number;
    last_seen_at: string | null;
  }>;
}

export function buildAdminStats(publicUrl: string, userId: string): AdminStats {
  const db = cloudDb();

  const singleParam = <T extends Record<string, unknown>>(sql: string): T =>
    (db.query<T, [string]>(sql).get(userId) ?? ({} as T));

  const c = {
    notes: singleParam<{ n: number }>("SELECT COUNT(*) AS n FROM notes WHERE user_id = ?").n ?? 0,
    notes_live: singleParam<{ n: number }>("SELECT COUNT(*) AS n FROM notes WHERE user_id = ? AND live = 1").n ?? 0,
    notes_final: singleParam<{ n: number }>("SELECT COUNT(*) AS n FROM notes WHERE user_id = ? AND is_final = 1").n ?? 0,
    live_entries: singleParam<{ n: number }>(
      `SELECT COUNT(*) AS n FROM live_entries le INNER JOIN notes n ON n.uuid = le.note_uuid WHERE n.user_id = ?`
    ).n ?? 0,
    assets: singleParam<{ n: number }>("SELECT COUNT(*) AS n FROM assets WHERE user_id = ?").n ?? 0,
    shares_active: singleParam<{ n: number }>(
      "SELECT COUNT(*) AS n FROM shares WHERE user_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > datetime('now'))"
    ).n ?? 0,
    shares_total: singleParam<{ n: number }>("SELECT COUNT(*) AS n FROM shares WHERE user_id = ?").n ?? 0,
    devices_active: singleParam<{ n: number }>("SELECT COUNT(*) AS n FROM devices WHERE user_id = ? AND revoked_at IS NULL").n ?? 0,
    devices_revoked: singleParam<{ n: number }>("SELECT COUNT(*) AS n FROM devices WHERE user_id = ? AND revoked_at IS NOT NULL").n ?? 0,
    tombstones: singleParam<{ n: number }>("SELECT COUNT(*) AS n FROM tombstones WHERE user_id = ?").n ?? 0,
  };

  let dbBytes = 0;
  try { dbBytes = statSync(cloudDbPath()).size; } catch {}
  const assetsBytes = singleParam<{ s: number | null }>("SELECT SUM(size_bytes) AS s FROM assets WHERE user_id = ?").s ?? 0;

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
      [string]
    >(
      `SELECT d.id, d.name, d.paired_at, d.last_seen_at, d.revoked_at,
              (SELECT COUNT(*) FROM notes WHERE origin_device_id = d.id) AS note_count,
              (SELECT MAX(updated_at) FROM notes WHERE origin_device_id = d.id) AS last_pushed_at
         FROM devices d
        WHERE d.user_id = ?
        ORDER BY (d.last_seen_at IS NULL), d.last_seen_at DESC, d.paired_at DESC`
    )
    .all(userId)
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
    .query<{ thread_id: string; count: number; latest: string }, [string]>(
      `SELECT thread_id, COUNT(*) AS count, MAX(created_at) AS latest
         FROM notes WHERE user_id = ? GROUP BY thread_id ORDER BY latest DESC LIMIT 20`
    )
    .all(userId);

  return {
    cloud: { name: "folio-cloud", version: pkg.version, public_url: publicUrl },
    user_id: userId,
    counts: c,
    storage: { db_bytes: dbBytes, assets_bytes: assetsBytes },
    devices,
    threads,
  };
}

/**
 * Operator-only whole-cloud snapshot used by `folio cloud user-list`. Not
 * exposed via HTTP — the CLI opens cloudDb() directly. One row per user with
 * per-user counts so the operator can spot a stale account or a runaway
 * uploader at a glance.
 */
export function buildGlobalStats(publicUrl: string): GlobalStats {
  const db = cloudDb();
  let dbBytes = 0;
  try { dbBytes = statSync(cloudDbPath()).size; } catch {}

  const users = db
    .query<
      {
        id: string;
        display_name: string;
        is_operator: number;
        created_at: string;
        deleted_at: string | null;
        devices: number;
        devices_revoked: number;
        notes: number;
        live_entries: number;
        assets: number;
        assets_bytes: number;
        shares_active: number;
        last_seen_at: string | null;
      },
      []
    >(
      `SELECT u.id, u.display_name, u.is_operator, u.created_at, u.deleted_at,
              (SELECT COUNT(*) FROM devices WHERE user_id = u.id AND revoked_at IS NULL) AS devices,
              (SELECT COUNT(*) FROM devices WHERE user_id = u.id AND revoked_at IS NOT NULL) AS devices_revoked,
              (SELECT COUNT(*) FROM notes WHERE user_id = u.id) AS notes,
              (SELECT COUNT(*) FROM live_entries le INNER JOIN notes n ON n.uuid = le.note_uuid WHERE n.user_id = u.id) AS live_entries,
              (SELECT COUNT(*) FROM assets WHERE user_id = u.id) AS assets,
              (SELECT COALESCE(SUM(size_bytes), 0) FROM assets WHERE user_id = u.id) AS assets_bytes,
              (SELECT COUNT(*) FROM shares WHERE user_id = u.id AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > datetime('now'))) AS shares_active,
              (SELECT MAX(last_seen_at) FROM devices WHERE user_id = u.id) AS last_seen_at
         FROM users u
        ORDER BY (u.deleted_at IS NOT NULL), u.created_at ASC`
    )
    .all()
    .map((r) => ({ ...r, is_operator: r.is_operator === 1 }));

  return {
    cloud: { name: "folio-cloud", version: pkg.version, public_url: publicUrl },
    storage: { db_bytes: dbBytes },
    users,
  };
}
