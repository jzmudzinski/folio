/**
 * Auth primitives + bearer middleware for the cloud relay.
 *
 * Token model:
 * - 32 random bytes, base64url-encoded → 43-char string (no padding).
 * - The plaintext token is returned ONCE to the device at pair time; only its
 *   SHA-256 hash is persisted server-side. Revocation = `UPDATE devices SET
 *   revoked_at = now WHERE id = ?`. Lost tokens = pair a new device.
 *
 * Pairing flow:
 * 1. Admin runs `folio cloud pair-code` on the server → 6-digit code, 10min TTL.
 * 2. Device hits POST /v1/auth/pair with `{code, device_name}`.
 * 3. Server validates code, creates device row + token, returns
 *    `{device_id, token}`. Plaintext token only travels once over TLS.
 *
 * Bearer middleware:
 * - Look up Authorization: Bearer <token> → sha256 → devices.token_hash.
 * - Reject if no match, or if device.revoked_at IS NOT NULL.
 * - On hit, throttle-update devices.last_seen_at (≥60s gap) and inject
 *   req.device into route context.
 *
 * Unauthed paths: /healthz, /manifest.webmanifest (PWA discovery, W3), /pair
 * (PWA pairing screen, W3), /p/:token/* (capability URLs, W4 — own validator).
 */

import { Database } from "bun:sqlite";
import { cloudDb, nextSeq as _unusedNext } from "./db";
import { randomBytes, createHash } from "node:crypto";

// UUIDv7 generator — time-sortable, used for device.id and elsewhere across
// the cloud-mvp work. RFC 9562. Format: 48 bits unix-ms timestamp, then 4 bits
// version (7), 12 bits random, 2 bits variant (10), then 62 bits random.
export function uuidv7(): string {
  const buf = randomBytes(16);
  const ts = Date.now();
  // 48 bits timestamp
  buf[0] = (ts / 2 ** 40) & 0xff;
  buf[1] = (ts / 2 ** 32) & 0xff;
  buf[2] = (ts / 2 ** 24) & 0xff;
  buf[3] = (ts / 2 ** 16) & 0xff;
  buf[4] = (ts / 2 ** 8) & 0xff;
  buf[5] = ts & 0xff;
  // version 7 in high nibble of byte 6
  buf[6] = (0x70 | (buf[6]! & 0x0f)) & 0xff;
  // variant 10 in high two bits of byte 8
  buf[8] = (0x80 | (buf[8]! & 0x3f)) & 0xff;
  const hex = buf.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Generate a fresh bearer token (43 chars base64url, no padding). */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 of a token, hex-encoded — what we persist. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Generate a 6-digit pairing code (zero-padded). 1 in 1M collision chance per gen. */
export function generatePairingCode(): string {
  const n = randomBytes(3).readUIntBE(0, 3) % 1000000;
  return n.toString(10).padStart(6, "0");
}

const PAIRING_TTL_MS = 10 * 60 * 1000;

export interface CreatePairingCodeResult {
  code: string;
  expiresAt: string; // ISO 8601
}

/**
 * Create a new pairing code. Caller is expected to print it on the server
 * console (NOT log it to journald with default settings, but for one-user MVP
 * we accept that — the code is short-lived and the journal is local).
 */
export function createPairingCode(db: Database = cloudDb()): CreatePairingCodeResult {
  // Clean up expired codes opportunistically — cheap, prevents indefinite growth.
  db.run("DELETE FROM pairing_codes WHERE expires_at < ?", [new Date().toISOString()]);
  // Retry once on the astronomically unlikely PK collision.
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = generatePairingCode();
    const expiresAt = new Date(Date.now() + PAIRING_TTL_MS).toISOString();
    try {
      db.run("INSERT INTO pairing_codes (code, expires_at) VALUES (?, ?)", [code, expiresAt]);
      return { code, expiresAt };
    } catch (e: any) {
      if (!/UNIQUE constraint/i.test(e?.message ?? "")) throw e;
      // collision: retry
    }
  }
  throw new Error("failed to allocate pairing code after retries — pairing_codes table possibly full");
}

export interface ConsumePairingResult {
  deviceId: string;
  token: string; // plaintext, return to caller, never persisted in plaintext
}

/**
 * Atomically consume a pairing code and create a device row. Idempotent on
 * the code: once used, the same code returns the same device on re-consume
 * (within TTL) — but the token is regenerated, invalidating any prior token
 * from that code. Reason: prevents an attacker who sniffed the first token
 * from continuing to use it if the legitimate device re-pairs.
 *
 * `clientDeviceId` is optional but strongly recommended: when supplied, the
 * cloud uses the client's stable local id (from FolioConfig.device_id) as
 * the canonical device id on this side too. This way `origin_device_id`
 * stamped server-side at push time matches what the client tracks locally,
 * so own-echo skip works on pull. If omitted (legacy clients), the cloud
 * falls back to generating its own UUIDv7 — but then the client must
 * accept and store this id locally to keep the two sides in sync.
 *
 * Throws if code unknown or expired.
 */
export function consumePairingCode(
  code: string,
  deviceName: string,
  clientDeviceId?: string,
  db: Database = cloudDb()
): ConsumePairingResult {
  const row = db
    .query<{ code: string; expires_at: string; used_by_device_id: string | null }, [string]>(
      "SELECT code, expires_at, used_by_device_id FROM pairing_codes WHERE code = ?"
    )
    .get(code);
  if (!row) throw new Error("invalid pairing code");
  if (new Date(row.expires_at).getTime() < Date.now()) throw new Error("pairing code expired");

  const token = generateToken();
  const tokenHash = hashToken(token);
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    let deviceId: string;
    if (row.used_by_device_id) {
      // Re-pair: rotate token on the existing device row.
      deviceId = row.used_by_device_id;
      db.run("UPDATE devices SET token_hash = ?, name = ?, paired_at = ?, revoked_at = NULL WHERE id = ?", [
        tokenHash,
        deviceName,
        now,
        deviceId,
      ]);
    } else {
      deviceId = clientDeviceId && clientDeviceId.length > 0 ? clientDeviceId : uuidv7();
      db.run(
        "INSERT INTO devices (id, name, token_hash, paired_at) VALUES (?, ?, ?, ?)",
        [deviceId, deviceName, tokenHash, now]
      );
      db.run("UPDATE pairing_codes SET used_by_device_id = ? WHERE code = ?", [deviceId, code]);
    }
    return deviceId;
  });
  const deviceId = tx();
  return { deviceId, token };
}

export interface Device {
  id: string;
  name: string;
  pairedAt: string;
  lastSeenAt: string | null;
}

/**
 * Resolve a bearer token (raw, from the header) to a device. Returns null if
 * unknown, expired, or revoked. Updates last_seen_at if the previous touch was
 * more than 60s ago (cheap throttle to avoid write per request).
 */
export function authenticate(token: string, db: Database = cloudDb()): Device | null {
  if (!token || token.length < 16) return null;
  const tokenHash = hashToken(token);
  const row = db
    .query<
      { id: string; name: string; paired_at: string; last_seen_at: string | null; revoked_at: string | null },
      [string]
    >(
      "SELECT id, name, paired_at, last_seen_at, revoked_at FROM devices WHERE token_hash = ?"
    )
    .get(tokenHash);
  if (!row) return null;
  if (row.revoked_at) return null;
  const now = Date.now();
  const lastSeen = row.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
  if (now - lastSeen > 60_000) {
    db.run("UPDATE devices SET last_seen_at = ? WHERE id = ?", [new Date(now).toISOString(), row.id]);
  }
  return {
    id: row.id,
    name: row.name,
    pairedAt: row.paired_at,
    lastSeenAt: row.last_seen_at,
  };
}

/** Pull bearer token out of an Authorization header. */
export function extractBearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1]!.trim() : null;
}

/** Mark a device revoked (immediate effect on next request). */
export function revokeDevice(id: string, db: Database = cloudDb()): void {
  db.run("UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", [
    new Date().toISOString(),
    id,
  ]);
}

/** List active (non-revoked) devices. For GET /v1/auth/devices. */
export function listDevices(db: Database = cloudDb()): Device[] {
  return db
    .query<
      { id: string; name: string; paired_at: string; last_seen_at: string | null },
      []
    >(
      "SELECT id, name, paired_at, last_seen_at FROM devices WHERE revoked_at IS NULL ORDER BY paired_at DESC"
    )
    .all()
    .map((r) => ({ id: r.id, name: r.name, pairedAt: r.paired_at, lastSeenAt: r.last_seen_at }));
}

/**
 * Paths that bypass bearer auth. /healthz for liveness probes;
 * /manifest.webmanifest + /pair for PWA bootstrap (W3); /p/:token/... for
 * capability URLs (W4, which have their own share validator).
 */
export function isPublicPath(pathname: string): boolean {
  if (pathname === "/healthz") return true;
  if (pathname === "/v1/version") return true;
  if (pathname === "/manifest.webmanifest") return true;
  // App shell is public — it contains no data, only a JS bootstrap that
  // reads the token from IndexedDB on the client. If no token, the shell
  // redirects to /pair. If token present, it fetches /v1/feed (authed).
  if (pathname === "/") return true;
  if (pathname === "/pair") return true;
  if (pathname.startsWith("/p/")) return true;
  // POST /v1/auth/pair is the entry point — also unauthed.
  if (pathname === "/v1/auth/pair") return true;
  // Icons + service worker served unauth for PWA bootstrap (W3).
  if (pathname.startsWith("/icons/")) return true;
  if (pathname === "/sw.js") return true;
  return false;
}
