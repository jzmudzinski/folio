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
import { renderNotePage, renderStandaloneNote } from "./render";
import { rawNoteHeaders } from "../core/csp";
import pkg from "../../package.json" with { type: "json" };

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  });
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

      // Capability URLs (W4) — stub
      if (path.startsWith("/p/")) {
        return json({ error: "capability URLs not yet implemented (W4)" }, 501);
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
          // W3 will fill this in. For W1, serve a minimal stub so paths exist.
          return json({
            name: "Folio",
            short_name: "Folio",
            display: "standalone",
            start_url: "/",
            icons: [],
          });
        }

        if (path === "/sw.js") {
          // W3 will fill this in. For W1, no-op SW so /sw.js doesn't 404.
          return new Response("// folio-cloud service worker stub (W3)\nself.addEventListener('install', () => self.skipWaiting());\n", {
            status: 200,
            headers: { "Content-Type": "application/javascript; charset=utf-8" },
          });
        }

        if (path === "/v1/auth/pair" && method === "POST") {
          const body = await readJsonBody<{ code?: string; device_name?: string }>(req);
          if (!body.code) return badRequest("code required");
          if (!body.device_name) return badRequest("device_name required");
          try {
            const { deviceId, token } = consumePairingCode(body.code, body.device_name);
            return json({ device_id: deviceId, token });
          } catch (e: any) {
            return badRequest(e?.message ?? "pairing failed");
          }
        }

        // ----- Authed paths below -----
        if (!device) return unauthorized(); // belt-and-braces; isPublicPath gate above ensures this

        if (path === "/v1/auth/devices" && method === "GET") {
          return json({ devices: listDevices() });
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

        // Note render routes — minimal version (full reuse of viewer/render.ts
        // would couple the cloud DB to local storage.ts queries; we render
        // standalone-style here and let the PWA (W3) wrap if it wants chrome).
        {
          const m = path.match(/^\/n\/([0-9a-f-]+)$/i);
          if (m && method === "GET") {
            const row = cloudDb()
              .query<{ uuid: string; title: string }, [string]>(
                "SELECT uuid, title FROM notes WHERE uuid = ?"
              )
              .get(m[1]!);
            if (!row) return notFound("note not found");
            return new Response(renderNotePage(row.uuid, row.title), {
              status: 200,
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
          }
        }

        {
          const m = path.match(/^\/raw\/([0-9a-f-]+)$/i);
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
