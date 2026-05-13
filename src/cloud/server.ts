/**
 * Folio Cloud relay — Bun HTTP server.
 *
 * Routes:
 *   GET    /healthz                       (public)
 *   GET    /v1/version                    (public, sparse — full info auth'd)
 *   POST   /v1/auth/pair                  (public — consumes pairing code)
 *   DELETE /v1/auth/device/:id            (authed)
 *   GET    /v1/auth/devices               (authed)
 *   POST   /v1/sync/push                  (authed)
 *   POST   /v1/sync/assets/:hash          (authed)
 *   GET    /v1/sync/assets/:hash          (authed, returns bytes)
 *   GET    /v1/sync/pull?since=<seq>      (authed)
 *   GET    /n/:uuid                       (authed — outer page with iframe)
 *   GET    /raw/:uuid                     (authed — body in theme, CSP locked)
 *   GET    /t/:thread_id                  (authed — thread index, minimal)
 *   GET    /manifest.webmanifest          (public — PWA, W3 placeholder)
 *   GET    /sw.js                         (public — PWA, W3 placeholder)
 *
 * Capability URLs `/p/:token/...` are stubbed for W4 (returns 501 today).
 *
 * Trust model: outside this file, treat req.device as the only authenticated
 * subject. Public paths (see isPublicPath in auth.ts) get no device context.
 */

import { cloudDb } from "./db";
import {
  authenticate,
  consumePairingCode,
  createPairingCode,
  extractBearer,
  isPublicPath,
  listDevices,
  revokeDevice,
  type Device,
} from "./auth";
import {
  handlePush,
  handlePull,
  storeAsset,
  readAsset,
  type PushPayload,
} from "./sync";
import { renderNotePage, renderStandaloneNote, renderSharedNotePage, renderSharedThreadPage } from "./render";
import { renderHome, renderPair, serviceWorkerJs, manifestJson, FOLIO_ICON_SVG, SW_VERSION } from "./pwa";
import {
  createShare,
  getShare,
  revokeShare,
  listShares,
  validateShareAccess,
  incrementShareViews,
} from "./shares";
import { rawNoteHeaders } from "../core/csp";
import pkg from "../../package.json" with { type: "json" };

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

function sharedHeaders(): Record<string, string> {
  // Same CSP as authed /raw/, plus belt-and-braces no-index + no-referrer to
  // limit capability-URL leakage via search engines and external Referers.
  return {
    ...rawNoteHeaders(),
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "Referrer-Policy": "no-referrer",
  };
}

/**
 * Handle `/p/:token/(n|raw|t)/:id` capability routes.
 *
 * Path layout:
 *   /p/<token>/n/<uuid>         → outer iframe page (server-rendered HTML)
 *   /p/<token>/raw/<uuid>       → body in theme + locked CSP (the actual content)
 *   /p/<token>/t/<thread_id>    → thread list (server-rendered HTML)
 *
 * Validation order:
 *   1. Token exists?
 *   2. Not revoked, not expired, view_count < max_views?
 *   3. Scope matches the requested resource?
 * Any failure returns the appropriate 4xx, no info leak about the missing
 * piece (404 + minimal body).
 *
 * View counting bumps only after a successful match, once per HIT
 * (including iframe-loaded /raw/ — each child iframe load counts). For
 * MVP this is fine; if it becomes noisy, throttle by token+UA later.
 */
function handleCapabilityRoute(path: string, method: string): Response {
  if (method !== "GET") {
    return new Response("method not allowed", { status: 405 });
  }
  const parts = path.split("/").filter(Boolean); // ["p", token, kind, id, ...]
  if (parts.length < 4 || parts[0] !== "p") {
    return new Response("not found", { status: 404 });
  }
  const token = parts[1]!;
  const kind = parts[2]!;
  const id = parts.slice(3).join("/");

  const share = getShare(token);
  if (!share) return new Response("not found", { status: 404 });

  // /p/:token/t/:thread/asset/:filename — capability-scoped asset access.
  // The share must cover the requested thread (either thread-scoped to it,
  // or note-scoped to a note in it).
  if (kind === "t" && parts.length === 6 && parts[4] === "asset") {
    const threadId = decodeURIComponent(parts[3]!);
    const filename = decodeURIComponent(parts[5]!);
    // Note-scoped tokens: scope must be a note whose thread_id matches.
    // Thread-scoped tokens: thread_id must equal scope_id.
    const validScope = share.scope_type === "thread"
      ? share.scope_id === threadId
      : (cloudDb()
          .query<{ thread_id: string }, [string]>("SELECT thread_id FROM notes WHERE uuid = ?")
          .get(share.scope_id)?.thread_id === threadId);
    if (!validScope) return new Response("not found", { status: 404 });
    if (share.revoked_at) return new Response("not found", { status: 404 });
    if (share.expires_at && new Date(share.expires_at).getTime() <= Date.now()) {
      return new Response("link expired", { status: 410 });
    }
    const row = cloudDb()
      .query<{ hash: string }, [string, string]>(
        "SELECT hash FROM assets WHERE thread_id = ? AND filename = ?"
      )
      .get(threadId, filename);
    if (!row) return new Response("not found", { status: 404 });
    const a = readAsset(row.hash);
    if (!a) return new Response("not found", { status: 404 });
    // Don't bump view_count for sub-resource fetches — would balloon per image.
    return new Response(a.bytes, {
      status: 200,
      headers: {
        "Content-Type": a.content_type,
        "Content-Length": String(a.size_bytes),
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
        "Referrer-Policy": "no-referrer",
      },
    });
  }

  if (kind === "n" || kind === "raw") {
    // Look up note for thread context (needed for thread-scoped validation
    // when caller targets a note). Same lookup is reused for rendering below.
    const note = cloudDb()
      .query<
        { uuid: string; title: string; theme: string; body_html: string; thread_id: string },
        [string]
      >("SELECT uuid, title, theme, body_html, thread_id FROM notes WHERE uuid = ?")
      .get(id);
    if (!note) return new Response("not found", { status: 404 });

    const v = validateShareAccess(share, { type: "note", uuid: note.uuid, thread_id: note.thread_id });
    if (!v.ok) return shareFailure(v.reason);

    if (kind === "n") {
      const body = renderSharedNotePage(token, note.uuid, note.title);
      const res = new Response(body, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "X-Robots-Tag": "noindex, nofollow, noarchive",
          "Referrer-Policy": "no-referrer",
        },
      });
      incrementShareViews(token);
      return res;
    }
    // kind === "raw"
    // Rewrite asset URLs in body_html so they route through the capability
    // scope. Relative refs like `/t/X/asset/foo.png` become
    // `/p/<token>/t/X/asset/foo.png`. Absolute refs to viewer_public_url
    // get the same treatment by matching the path suffix.
    const rewrittenBody = note.body_html.replace(
      /((?:href|src)\s*=\s*["'])([^"']*?)\/t\/([^/"']+)\/asset\/([^"'?#]+)(["'])/g,
      (_match, prefix: string, _leading: string, thread: string, filename: string, quote: string) =>
        `${prefix}/p/${token}/t/${thread}/asset/${filename}${quote}`
    );
    const body = renderStandaloneNote({
      title: note.title,
      theme: note.theme,
      bodyHtml: rewrittenBody,
    });
    const res = new Response(body, { status: 200, headers: sharedHeaders() });
    // Don't bump on /raw/ — it's loaded inside the iframe spawned by /n/,
    // so we'd double-count every page view. View counting happens at /n/.
    return res;
  }

  if (kind === "t") {
    const v = validateShareAccess(share, { type: "thread", thread_id: id });
    if (!v.ok) return shareFailure(v.reason);
    const notes = cloudDb()
      .query<
        { uuid: string; title: string; type: string; created_at: string; is_final: number },
        [string]
      >(
        `SELECT uuid, title, type, created_at, is_final FROM notes
          WHERE thread_id = ? ORDER BY created_at DESC`
      )
      .all(id);
    const body = renderSharedThreadPage(
      token,
      id,
      notes.map((n) => ({
        uuid: n.uuid,
        title: n.title,
        type: n.type,
        created_at: n.created_at,
        is_final: n.is_final === 1,
      }))
    );
    const res = new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
        "Referrer-Policy": "no-referrer",
      },
    });
    incrementShareViews(token);
    return res;
  }

  return new Response("not found", { status: 404 });
}

function shareFailure(reason: string): Response {
  // Deliberately terse to avoid info leak. 410 Gone for expired, 404 for the rest.
  if (reason === "expired") {
    return new Response("link expired", { status: 410, headers: { "Cache-Control": "no-store" } });
  }
  return new Response("not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}

function text(body: string, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...extraHeaders } });
}

function unauthorized(): Response {
  return json({ error: "unauthorized" }, 401, { "WWW-Authenticate": 'Bearer realm="folio-cloud"' });
}

function notFound(msg = "not found"): Response {
  return json({ error: msg }, 404);
}

function badRequest(msg: string): Response {
  return json({ error: msg }, 400);
}

function serverError(msg: string): Response {
  return json({ error: msg }, 500);
}

async function readJsonBody<T>(req: Request): Promise<T> {
  const text = await req.text();
  if (!text) throw new Error("empty body");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("invalid JSON body");
  }
}

export interface CloudServerOptions {
  port?: number;
  hostname?: string;
  publicUrl?: string;
}

export function startCloudServer(opts: CloudServerOptions = {}): ReturnType<typeof Bun.serve> {
  // Initialize DB eagerly so a missing /var/lib/folio-cloud surfaces immediately.
  cloudDb();
  const port = opts.port ?? Number(process.env.FOLIO_CLOUD_PORT ?? 8081);
  const hostname = opts.hostname ?? process.env.FOLIO_CLOUD_HOST ?? "127.0.0.1";
  const publicUrl = (opts.publicUrl ?? process.env.FOLIO_CLOUD_PUBLIC_URL ?? `http://${hostname}:${port}`).replace(/\/+$/, "");

  return Bun.serve({
    hostname,
    port,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method;

      // Capability URLs — public read access to a single note or thread
      // gated by a bearer-style token in the URL path. Token is the
      // credential; server validates on every hit. Atomic view_count bump
      // happens after the response is rendered (caller chooses idempotency).
      if (path.startsWith("/p/")) {
        return handleCapabilityRoute(path, method);
      }

      // Auth: public paths skip; everything else needs a valid bearer.
      let device: Device | null = null;
      if (!isPublicPath(path)) {
        const token = extractBearer(req);
        if (!token) return unauthorized();
        device = authenticate(token);
        if (!device) return unauthorized();
      }

      try {
        // ----- Public paths -----
        if (path === "/healthz") return json({ ok: true });

        if (path === "/v1/version") {
          return json({ name: "folio-cloud", version: pkg.version, public_url: publicUrl });
        }

        if (path === "/manifest.webmanifest") {
          return new Response(JSON.stringify(manifestJson(publicUrl), null, 2), {
            status: 200,
            headers: {
              "Content-Type": "application/manifest+json; charset=utf-8",
              "Cache-Control": "public, max-age=300",
            },
          });
        }

        if (path === "/sw.js") {
          return new Response(serviceWorkerJs(), {
            status: 200,
            headers: {
              "Content-Type": "application/javascript; charset=utf-8",
              "Service-Worker-Allowed": "/",
              "Cache-Control": "no-cache",
            },
          });
        }

        if (path === "/icons/folio.svg") {
          return new Response(FOLIO_ICON_SVG, {
            status: 200,
            headers: {
              "Content-Type": "image/svg+xml; charset=utf-8",
              "Cache-Control": "public, max-age=86400, immutable",
            },
          });
        }

        if (path === "/" && method === "GET") {
          return new Response(renderHome(publicUrl), {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }

        if (path === "/pair" && method === "GET") {
          return new Response(renderPair(publicUrl), {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }

        if (path === "/v1/auth/pair" && method === "POST") {
          const body = await readJsonBody<{ code?: string; device_name?: string; device_id?: string }>(req);
          if (!body.code) return badRequest("code required");
          if (!body.device_name) return badRequest("device_name required");
          try {
            const { deviceId, token } = consumePairingCode(body.code, body.device_name, body.device_id);
            return json({ device_id: deviceId, token });
          } catch (e: any) {
            return badRequest(e?.message ?? "pairing failed");
          }
        }

        // /n/:uuid — public JS shell. Reads bearer token from IDB client-side
        // and fetches /raw/:uuid with auth. Outer page exposes nothing
        // beyond the uuid that's already in the URL.
        {
          const m = path.match(/^\/n\/([0-9A-Za-z-]+)$/);
          if (m && method === "GET") {
            return new Response(renderNotePage(m[1]!, ""), {
              status: 200,
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
          }
        }

        // /t/:thread_id/asset/:filename — PUBLIC asset bytes. Lookup is
        // (thread_id, filename) → assets table → blob_path on disk. Why
        // public: notes referenced assets via this URL pattern from local
        // viewer, and sub-resource fetches from null-origin sandboxed
        // iframes can't reliably carry bearer headers. URLs aren't trivially
        // enumerable (need to know both thread_id slug and filename),
        // matching the local viewer's posture.
        {
          const m = path.match(/^\/t\/([^/]+)\/asset\/([^/]+)$/);
          if (m && method === "GET") {
            const threadId = decodeURIComponent(m[1]!);
            const filename = decodeURIComponent(m[2]!);
            const row = cloudDb()
              .query<
                { blob_path: string; content_type: string; size_bytes: number; hash: string },
                [string, string]
              >("SELECT blob_path, content_type, size_bytes, hash FROM assets WHERE thread_id = ? AND filename = ?")
              .get(threadId, filename);
            if (!row) return notFound("asset not found");
            const a = readAsset(row.hash);
            if (!a) return notFound("asset bytes missing");
            return new Response(a.bytes, {
              status: 200,
              headers: {
                "Content-Type": a.content_type,
                "Content-Length": String(a.size_bytes),
                "Cache-Control": "public, max-age=86400, immutable",
                "X-Content-Type-Options": "nosniff",
              },
            });
          }
        }

        // /t/:thread_id — public JS shell, same renderer as /. JS reads
        // location.pathname → /t/<id> and fetches /v1/feed?thread=<id>.
        {
          const m = path.match(/^\/t\/([^/]+)$/);
          if (m && method === "GET") {
            return new Response(renderHome(publicUrl), {
              status: 200,
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
          }
        }

        // ----- Authed paths below -----
        if (!device) return unauthorized(); // belt-and-braces; isPublicPath gate above ensures this

        if (path === "/v1/auth/devices" && method === "GET") {
          return json({ devices: listDevices() });
        }

        // Already-paired devices can request fresh pairing codes for
        // onboarding additional devices — eliminates the SSH-to-server
        // step for every device after the first. Caller's token must be
        // valid; the new code itself is no-auth-needed by design (so
        // the recipient device can pair without any pre-shared state).
        if (path === "/v1/auth/pair-code" && method === "POST") {
          const { code, expiresAt } = createPairingCode();
          return json({ code, expires_at: expiresAt });
        }

        {
          const m = path.match(/^\/v1\/auth\/device\/([^/]+)$/);
          if (m && method === "DELETE") {
            revokeDevice(m[1]!);
            return json({ revoked: m[1] });
          }
        }

        if (path === "/v1/sync/push" && method === "POST") {
          const payload = await readJsonBody<PushPayload>(req);
          const result = handlePush(payload, device.id);
          return json(result);
        }

        if (path === "/v1/sync/pull" && method === "GET") {
          const since = Number(url.searchParams.get("since") ?? 0);
          if (!Number.isFinite(since) || since < 0) return badRequest("invalid since cursor");
          return json(handlePull(since));
        }

        // ---- Shares (capability URL admin) ----
        if (path === "/v1/share" && method === "POST") {
          const body = await readJsonBody<{
            scope_type?: "note" | "thread";
            scope_id?: string;
            expires_in_days?: number | null;
            max_views?: number | null;
          }>(req);
          if (body.scope_type !== "note" && body.scope_type !== "thread") {
            return badRequest("scope_type must be 'note' or 'thread'");
          }
          if (!body.scope_id) return badRequest("scope_id required");
          try {
            const share = createShare({
              scope_type: body.scope_type,
              scope_id: body.scope_id,
              created_by_device: device!.id,
              expires_in_days: body.expires_in_days ?? 7,
              max_views: body.max_views ?? null,
            });
            const scopePath =
              share.scope_type === "note"
                ? `/p/${share.token}/n/${share.scope_id}`
                : `/p/${share.token}/t/${share.scope_id}`;
            return json({
              token: share.token,
              url: `${publicUrl}${scopePath}`,
              scope_type: share.scope_type,
              scope_id: share.scope_id,
              created_at: share.created_at,
              expires_at: share.expires_at,
              max_views: share.max_views,
            });
          } catch (e: any) {
            return badRequest(e?.message ?? "share creation failed");
          }
        }

        {
          const m = path.match(/^\/v1\/share\/([A-Za-z0-9_\-]+)$/);
          if (m && method === "DELETE") {
            const ok = revokeShare(m[1]!);
            return json({ revoked: ok ? m[1] : null });
          }
        }

        if (path === "/v1/shares" && method === "GET") {
          const scope_id = url.searchParams.get("scope_id") ?? undefined;
          const shares = listShares({
            scope_id: scope_id ?? undefined,
            created_by_device: device!.id,
          });
          return json({
            shares: shares.map((s) => ({
              token: s.token,
              url: `${publicUrl}/p/${s.token}/${s.scope_type === "note" ? "n" : "t"}/${s.scope_id}`,
              scope_type: s.scope_type,
              scope_id: s.scope_id,
              created_at: s.created_at,
              expires_at: s.expires_at,
              max_views: s.max_views,
              view_count: s.view_count,
            })),
          });
        }

        if (path === "/v1/feed" && method === "GET") {
          // Lightweight list for the PWA home screen — no body_html.
          // Supports two optional filters:
          //   ?q=<query>     — case-insensitive LIKE across title + plain_text
          //   ?thread=<id>   — exact thread_id match
          // LIKE-search is sufficient at the one-user-many-notes scale we're
          // sized for; bumping to FTS5 here is straightforward later (new
          // virtual table populated on push) if the n-of-notes outgrows it.
          const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 500);
          const q = (url.searchParams.get("q") ?? "").trim();
          const thread = (url.searchParams.get("thread") ?? "").trim();
          const where: string[] = [];
          const params: any[] = [];
          if (q) {
            // Tokenize on whitespace; require every token match in title OR plain_text.
            // ESCAPE \\ for LIKE so a literal % or _ from the user doesn't wildcard.
            for (const tok of q.split(/\s+/).filter(Boolean)) {
              where.push(
                "(LOWER(title) LIKE ? ESCAPE '\\' OR LOWER(plain_text) LIKE ? ESCAPE '\\')"
              );
              const needle = "%" + tok.toLowerCase().replace(/[\\%_]/g, "\\$&") + "%";
              params.push(needle, needle);
            }
          }
          if (thread) {
            where.push("thread_id = ?");
            params.push(thread);
          }
          const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
          const sql =
            `SELECT uuid, slug, title, type, theme, thread_id, created_at, updated_at, is_final, live` +
            ` FROM notes ${whereClause} ORDER BY created_at DESC LIMIT ?`;
          const notes = cloudDb()
            .query<
              {
                uuid: string;
                slug: string;
                title: string;
                type: string;
                theme: string;
                thread_id: string;
                created_at: string;
                updated_at: string;
                is_final: number;
                live: number;
              },
              any[]
            >(sql)
            .all(...params, limit);
          const threads = cloudDb()
            .query<{ thread_id: string; count: number; latest: string }, []>(
              `SELECT thread_id, COUNT(*) AS count, MAX(created_at) AS latest
                 FROM notes GROUP BY thread_id ORDER BY latest DESC LIMIT 50`
            )
            .all();
          return json({
            notes: notes.map((n) => ({
              uuid: n.uuid,
              slug: n.slug,
              title: n.title,
              type: n.type,
              theme: n.theme,
              thread_id: n.thread_id,
              created_at: n.created_at,
              updated_at: n.updated_at,
              is_final: n.is_final === 1,
              live: n.live === 1,
            })),
            threads,
            query: q || undefined,
            thread: thread || undefined,
            sw_version: SW_VERSION,
          });
        }

        {
          const m = path.match(/^\/v1\/sync\/assets\/([a-f0-9]{64})$/);
          if (m) {
            const hash = m[1]!;
            if (method === "POST") {
              const filename = req.headers.get("x-folio-filename");
              const threadId = req.headers.get("x-folio-thread-id");
              if (!filename) return badRequest("x-folio-filename header required");
              if (!threadId) return badRequest("x-folio-thread-id header required");
              const bytes = new Uint8Array(await req.arrayBuffer());
              try {
                const result = storeAsset(hash, filename, threadId, bytes);
                return json(result);
              } catch (e: any) {
                return badRequest(e?.message ?? "asset upload failed");
              }
            }
            if (method === "HEAD") {
              const a = readAsset(hash);
              if (!a) return new Response(null, { status: 404 });
              return new Response(null, {
                status: 200,
                headers: { "Content-Type": a.content_type, "Content-Length": String(a.size_bytes) },
              });
            }
            if (method === "GET") {
              const a = readAsset(hash);
              if (!a) return notFound("asset not found");
              return new Response(a.bytes, {
                status: 200,
                headers: {
                  "Content-Type": a.content_type,
                  "Content-Length": String(a.size_bytes),
                  "Cache-Control": "public, max-age=86400, immutable",
                },
              });
            }
          }
        }

        // (/n/:uuid handled above as public route — see comment near auth gate.)

        {
          const m = path.match(/^\/raw\/([0-9A-Za-z-]+)$/);
          if (m && method === "GET") {
            const row = cloudDb()
              .query<{ title: string; theme: string; body_html: string }, [string]>(
                "SELECT title, theme, body_html FROM notes WHERE uuid = ?"
              )
              .get(m[1]!);
            if (!row) return notFound("note not found");
            return new Response(
              renderStandaloneNote({ title: row.title, theme: row.theme, bodyHtml: row.body_html }),
              { status: 200, headers: rawNoteHeaders() }
            );
          }
        }

        {
          const m = path.match(/^\/t\/([^/]+)$/);
          if (m && method === "GET") {
            const notes = cloudDb()
              .query<{ uuid: string; title: string; created_at: string }, [string]>(
                "SELECT uuid, title, created_at FROM notes WHERE thread_id = ? ORDER BY created_at DESC"
              )
              .all(m[1]!);
            return json({ thread_id: m[1], notes });
          }
        }

        return notFound();
      } catch (e: any) {
        if (process.env.FOLIO_DEBUG) console.error("[folio-cloud]", e);
        return serverError(e?.message ?? "internal error");
      }
    },
  });
}
