/**
 * `folio sync` — pair/init or run the daemon.
 *
 * Subcommands implicit via flags:
 *   folio sync pair --remote https://cloud.example.com --code 482910 [--name laptop]
 *     → Consumes pairing code, writes device_token + remote to .sync-state.json.
 *
 *   folio sync [--once] [--interval 30]
 *     → Pull + push + push-live in a loop. --once exits after one iteration
 *       (useful for cron). Default interval 30s.
 *
 *   folio sync status
 *     → Print sync state file contents (without revealing the token).
 *
 *   folio sync unpair
 *     → Revoke this device on the cloud (best effort) + delete local state.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { hostname } from "node:os";
import { c, out, err } from "../io";
import {
  acquireLock,
  releaseLock,
  loadSyncState,
  saveSyncState,
  syncOnce,
  LockHeldError,
  type SyncState,
} from "../../core/sync";
import { getOrCreateDeviceId } from "../../core/config";

export interface SyncOpts {
  sub?: string;
  remote?: string;
  code?: string;
  name?: string;
  once?: boolean;
  interval?: number;
  jsonOut?: boolean;
}

export async function syncCmd(opts: SyncOpts): Promise<number> {
  switch (opts.sub) {
    case "pair":
      return pairCmd(opts);
    case "status":
      return statusCmd(opts);
    case "unpair":
      return unpairCmd(opts);
    case undefined:
    case "":
    case "run":
      return runCmd(opts);
    default:
      err(c.err(`✗ Unknown sync subcommand: ${opts.sub}\n`));
      err("Usage: folio sync {pair|status|unpair|run}\n");
      return 1;
  }
}

async function pairCmd(opts: SyncOpts): Promise<number> {
  if (!opts.remote) { err(c.err("✗ --remote required\n")); return 2; }
  if (!opts.code) { err(c.err("✗ --code required (run `folio cloud pair-code` on the server)\n")); return 2; }
  const remote = opts.remote.replace(/\/+$/, "");
  const name = opts.name ?? hostname();
  // Resolve local device_id BEFORE pairing so cloud stores the same id we
  // use locally. Without this the two sides drift and own-echo skip breaks.
  const localDev = getOrCreateDeviceId();

  const res = await fetch(`${remote}/v1/auth/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: opts.code, device_name: name, device_id: localDev.id }),
  });
  if (!res.ok) {
    let detail = ""; try { detail = await res.text(); } catch {}
    err(c.err(`✗ pair failed: HTTP ${res.status} ${detail.slice(0, 200)}\n`));
    return 3;
  }
  const body = (await res.json()) as { device_id: string; token: string };
  const state: SyncState = {
    remote,
    device_token: body.token,
    last_pulled_seq: 0,
    last_pushed_at: null,
    last_live_pushed: {},
  };
  saveSyncState(state); // saves chmod 600 — see saveSyncState in core/sync.ts
  const dev = getOrCreateDeviceId();
  // Output a short fingerprint of the token for human verification without
  // exposing the full bearer. The actual token lives only in the state file
  // (mode 0600). Avoids the trap where someone screen-shares or pastes the
  // CLI confirmation into chat — fingerprint is useless on its own.
  const fp = tokenFingerprint(body.token);
  out(c.ok("✓") + ` Paired with ${c.cyan(remote)}`);
  out(`  device_id:  ${c.dim(body.device_id)}`);
  out(`  local id:   ${c.dim(dev.id)}`);
  out(`  token fp:   ${c.dim(fp)} ${c.dim("(stored in ~/Folio/.sync-state.json, mode 0600)")}`);
  out("");
  out(c.dim("  Run `folio sync` to start the daemon, or `folio sync --once` for cron mode."));
  return 0;
}

/**
 * Short visual fingerprint of a bearer token — first 4 + last 4 chars
 * with the middle elided. Enough for the user to see "the same token is
 * in my state file" without exposing anything an attacker could replay.
 * Plain truncation (first 8) would leak more on its own — a fingerprint
 * with elision signals "this is NOT the full token" visually.
 */
function tokenFingerprint(token: string): string {
  if (token.length < 12) return "…";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

async function statusCmd(opts: SyncOpts): Promise<number> {
  const state = loadSyncState();
  if (!state) {
    out(c.dim("Not paired. Run: folio sync pair --remote <url> --code <6-digit>"));
    return 0;
  }
  if (opts.jsonOut) {
    out(JSON.stringify({
      remote: state.remote,
      paired: true,
      last_pulled_seq: state.last_pulled_seq,
      last_pushed_at: state.last_pushed_at,
      live_notes_tracked: Object.keys(state.last_live_pushed ?? {}).length,
    }, null, 2));
    return 0;
  }
  const dev = getOrCreateDeviceId();
  out(c.bold("Folio sync status"));
  out(`  remote:              ${c.cyan(state.remote)}`);
  out(`  device_id:           ${dev.id} (${dev.name})`);
  out(`  last_pulled_seq:     ${state.last_pulled_seq}`);
  out(`  last_pushed_at:      ${state.last_pushed_at ?? c.dim("(never)")}`);
  out(`  live notes tracked:  ${Object.keys(state.last_live_pushed ?? {}).length}`);
  return 0;
}

async function unpairCmd(_opts: SyncOpts): Promise<number> {
  const state = loadSyncState();
  if (!state) {
    out(c.dim("Not paired — nothing to unpair."));
    return 0;
  }
  // Look up our device id from the server's perspective so we can DELETE.
  try {
    const listRes = await fetch(`${state.remote}/v1/auth/devices`, {
      headers: { Authorization: `Bearer ${state.device_token}` },
    });
    if (listRes.ok) {
      const { devices } = (await listRes.json()) as { devices: { id: string; name: string }[] };
      const me = devices.find((d) => d.name === hostname());
      if (me) {
        await fetch(`${state.remote}/v1/auth/device/${me.id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${state.device_token}` },
        });
        out(c.ok("✓") + ` Revoked device ${c.dim(me.id)} on ${state.remote}`);
      }
    }
  } catch {
    out(c.dim("(could not contact server — local state cleared anyway)"));
  }
  try { unlinkSync(`${require("../../core/config").folioRoot()}/.sync-state.json`); } catch {}
  out(c.ok("✓") + " Local sync state cleared.");
  return 0;
}

async function runCmd(opts: SyncOpts): Promise<number> {
  const state = loadSyncState();
  if (!state) {
    err(c.err("✗ Not paired. Run: folio sync pair --remote <url> --code <6-digit>\n"));
    return 2;
  }
  try {
    acquireLock();
  } catch (e: any) {
    if (e instanceof LockHeldError) {
      err(c.err(`✗ ${e.message}\n`));
      err(c.dim("  If sure no other folio sync is running, remove ~/Folio/.sync.lock and retry.\n"));
      return 3;
    }
    throw e;
  }

  const interval = opts.interval ?? 30;
  const once = opts.once ?? false;

  // Clean shutdown on signals — important under systemd or supervisord.
  let stopping = false;
  const onSignal = (sig: string) => {
    if (stopping) return;
    stopping = true;
    out(c.dim(`\n  received ${sig}, finishing current iteration...`));
  };
  process.on("SIGTERM", () => onSignal("SIGTERM"));
  process.on("SIGINT", () => onSignal("SIGINT"));

  try {
    do {
      try {
        const r = await syncOnce(state);
        if (r.pulled || r.pushed || r.live_pulled || r.live_pushed || r.renamed || r.deleted || r.deletes_applied || r.assets_pushed || r.assets_pulled) {
          out(
            `${c.dim(new Date().toISOString())} ` +
              `pulled=${r.pulled} pushed=${r.pushed} ` +
              `live_pulled=${r.live_pulled} live_pushed=${r.live_pushed} ` +
              `renamed=${r.renamed} deleted=${r.deleted} deletes_applied=${r.deletes_applied} ` +
              `assets↑=${r.assets_pushed} assets↓=${r.assets_pulled}`
          );
        }
      } catch (e: any) {
        // Transient network errors should not crash the daemon — log and retry.
        err(c.err(`  ${new Date().toISOString()} sync error: ${e?.message ?? e}\n`));
        if (process.env.FOLIO_DEBUG) console.error(e);
      }
      if (once || stopping) break;
      await new Promise<void>((resolve) => setTimeout(resolve, interval * 1000));
    } while (!stopping);
  } finally {
    releaseLock();
  }
  return 0;
}
