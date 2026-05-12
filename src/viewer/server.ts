import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, folioRoot, bundledThemesDir, themesDir, viewerPublicBaseUrl, threadAssetsDir, isSafeAssetFilename } from "../core/config";
import { listNotes, searchNotes, getNoteMeta, readNoteHtml, stats, finalize, listThreads, listPopularTags, listNotesByTag } from "../core/storage";
import { db, logEvent } from "../core/db";
import { pageList, pageSearch, pageThread, pageThreads, pageNote, pageStats, pageError, pageTag } from "./render";
import { injectBootstrap } from "./note-bootstrap";
import pkg from "../../package.json" with { type: "json" };
import type { NoteType } from "../core/types";

function htmlResp(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
function jsonResp(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj, null, 2), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

function countSummary(): { all: number; final: number; expiring: number; byType: Record<string, number> } {
  const d = db();
  const all = d.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM notes WHERE status='active'").get()?.n ?? 0;
  const final = d.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM notes WHERE is_final=1 AND status='active'").get()?.n ?? 0;
  const expiring = d.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM notes WHERE is_final=0 AND status='active' AND expires_at < datetime('now','+7 days')").get()?.n ?? 0;
  const byType: Record<string, number> = {};
  for (const r of d.query<{ type: string; n: number }, []>("SELECT type, COUNT(*) AS n FROM notes WHERE status='active' GROUP BY type").all()) {
    byType[r.type] = r.n;
  }
  return { all, final, expiring, byType };
}

const RAW_NOTE_CSP = [
  "default-src 'self' 'unsafe-inline' data: blob: https:",
  "script-src 'self' 'unsafe-inline' https:",
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' data: blob: https: http:",
  "font-src 'self' data: https:",
  "connect-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'none'",
  "base-uri 'self'",
].join("; ");

function rawNoteHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": RAW_NOTE_CSP,
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "no-referrer",
  };
}

// Whitelist of asset extensions the viewer will serve from
// threads/<id>/assets/. Everything else gets 415. Keep this list small —
// each new entry expands the trust surface for what an agent (or bot) can
// drop into a user's Folio. Binary formats only; markdown/HTML go in the
// note body, not as assets.
const ASSET_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  mp4: "video/mp4",
};

export function assetMimeForExt(filename: string): string | null {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = filename.slice(dot + 1).toLowerCase();
  return ASSET_MIME[ext] ?? null;
}

function resolveTheme(name: string): string | null {
  for (const root of [themesDir(), bundledThemesDir()]) {
    const p = join(root, name, "theme.css");
    if (existsSync(p)) return readFileSync(p, "utf-8");
  }
  return null;
}

export async function startServer(): Promise<ReturnType<typeof Bun.serve>> {
  const cfg = await loadConfig();
  const server = Bun.serve({
    hostname: cfg.viewer_host,
    port: cfg.viewer_port,
    async fetch(req): Promise<Response> {
      const url = new URL(req.url);
      const path = url.pathname;

      try {
        // GET /
        if (req.method === "GET" && path === "/") {
          const type = url.searchParams.get("type") as NoteType | null;
          const tag = url.searchParams.get("tag");
          const finalOnly = url.searchParams.get("final") === "1";
          const expiring = url.searchParams.get("expiring") === "1";
          let notes = listNotes({
            type: type ?? undefined,
            tag: tag ?? undefined,
            is_final: finalOnly ? true : undefined,
            limit: 100,
          });
          if (expiring) {
            notes = notes.filter((n) => !n.is_final && n.expires_at && new Date(n.expires_at).getTime() - Date.now() < 7 * 86400000);
          }
          const popularTags = listPopularTags(20);
          return htmlResp(pageList(notes, countSummary(), type ?? undefined, finalOnly ? "final" : expiring ? "expiring" : undefined, popularTags, tag ?? undefined));
        }

        // GET /search?q=...
        if (req.method === "GET" && path === "/search") {
          const q = url.searchParams.get("q") ?? "";
          if (!q.trim()) return Response.redirect("/", 302);
          const t0 = Date.now();
          const hits = searchNotes({ query: q, limit: 30 });
          const threadHits = listThreads(q, 20);
          return htmlResp(pageSearch(q, hits, threadHits, countSummary(), Date.now() - t0));
        }

        // GET /threads — list all threads, optional ?q= filter
        if (req.method === "GET" && path === "/threads") {
          const q = url.searchParams.get("q") ?? "";
          const threads = listThreads(q || undefined, 500);
          return htmlResp(pageThreads(threads, q || undefined));
        }

        // GET /t/:thread_id/asset/:filename  (per-thread binary asset)
        //
        // Must come BEFORE the bare /t/:thread_id handler — that one would
        // otherwise consume any path under /t/ and try to look it up as a
        // thread. Filename is validated against isSafeAssetFilename after
        // URL-decoding to prevent path traversal; MIME is sniffed from the
        // extension against a strict whitelist (jpg/png/webp/gif/svg/pdf/mp4);
        // anything else gets 415. Assets are append-only in convention so we
        // cache aggressively (1 day).
        {
          const m = path.match(/^\/t\/([^/]+)\/asset\/(.+)$/);
          if (req.method === "GET" && m) {
            const threadId = decodeURIComponent(m[1]!);
            const filename = decodeURIComponent(m[2]!);
            if (!isSafeAssetFilename(filename)) {
              return new Response("invalid filename", { status: 400 });
            }
            const mime = assetMimeForExt(filename);
            if (!mime) {
              return new Response("unsupported asset type", { status: 415 });
            }
            const filePath = join(threadAssetsDir(threadId), filename);
            if (!existsSync(filePath)) {
              return new Response("not found", { status: 404 });
            }
            const buf = readFileSync(filePath);
            return new Response(new Uint8Array(buf), {
              headers: {
                "Content-Type": mime,
                "Content-Length": String(buf.length),
                "Cache-Control": "public, max-age=86400",
                "X-Content-Type-Options": "nosniff",
              },
            });
          }
        }

        // GET /t/:thread_id
        if (req.method === "GET" && path.startsWith("/t/")) {
          const tid = decodeURIComponent(path.slice(3));
          const notes = listNotes({ thread_id: tid, limit: 200 });
          if (notes.length === 0) return htmlResp(pageError(404, `Thread "${tid}" not found.`), 404);
          return htmlResp(pageThread(tid, notes));
        }

        // GET /tag/:slug — wszystkie noty z tagiem
        if (req.method === "GET" && path.startsWith("/tag/")) {
          const tag = decodeURIComponent(path.slice(5));
          if (!tag) return Response.redirect("/", 302);
          const notes = listNotesByTag(tag, 200);
          if (notes.length === 0) return htmlResp(pageError(404, `No notes tagged "${tag}".`), 404);
          return htmlResp(pageTag(tag, notes, listPopularTags(20)));
        }

        // GET /n/:id/stream  (SSE — live notes only)
        //
        // Sends the existing entries as backlog, then streams new entries
        // as they're appended via append_entry (MCP) or folio append (CLI).
        // 404 if note doesn't exist, isn't live, or is already finalized.
        // The body iframe (/raw/:id) is unrelated and unchanged — this
        // endpoint feeds the chrome-side panel only.
        {
          const m = path.match(/^\/n\/([^/]+)\/stream$/);
          if (req.method === "GET" && m) {
            const id = m[1]!;
            const note = getNoteMeta(id);
            if (!note) return new Response("not found", { status: 404 });
            if (!note.live) return new Response("not a live note", { status: 404 });
            if (note.is_final) return new Response("note is final", { status: 404 });

            const { entriesPath, readEntries } = await import("../core/live");
            const { subscribe } = await import("../core/sse-hub");
            const jsonl = entriesPath(join(folioRoot(), note.path));

            // EventSource auto-reconnects on transport hiccups and sets
            // Last-Event-ID to the most recent `id:` line it received. We
            // use that to skip backlog the client already has, avoiding
            // duplicate frames after a reconnect.
            const lastEventId = req.headers.get("last-event-id") ?? "";

            const stream = new ReadableStream({
              start(controller) {
                const encoder = new TextEncoder();
                // Each frame carries `id: <entry.id>` so EventSource
                // sets Last-Event-ID on subsequent reconnects.
                const emit = (entry: any) => {
                  try {
                    controller.enqueue(encoder.encode(`id: ${entry.id}\nevent: entry\ndata: ${JSON.stringify(entry)}\n\n`));
                  } catch {
                    // Stream closed mid-write — cleanup happens via cancel().
                  }
                };

                // Emit backlog. On a fresh connection lastEventId is "",
                // we send everything. On a reconnect, find the position
                // of the last delivered entry and send only what's after.
                const backlog = readEntries(jsonl);
                let startFrom = 0;
                if (lastEventId) {
                  const idx = backlog.findIndex((e) => e.id === lastEventId);
                  if (idx >= 0) startFrom = idx + 1;
                }
                for (let i = startFrom; i < backlog.length; i++) emit(backlog[i]!);

                // Now subscribe for live updates. The hub seeds offset
                // at current file size, so backlog won't replay.
                const unsubscribe = subscribe(id, jsonl, emit);
                // Hold the unsubscribe so we can call it on cancel.
                (controller as any).__folioUnsub = unsubscribe;
              },
              cancel() {
                const unsub = (this as any).__folioUnsub;
                if (typeof unsub === "function") {
                  try { unsub(); } catch { /* ignore */ }
                }
              },
            });

            return new Response(stream, {
              headers: {
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-cache, no-transform",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
              },
            });
          }
        }

        // GET /entries.css  (baseline styles for compiled-final live notes
        // and the live-feed panel iframe — see src/viewer/entries-css.ts).
        if (req.method === "GET" && path === "/entries.css") {
          const { ENTRIES_CSS } = await import("./entries-css");
          return new Response(ENTRIES_CSS, {
            headers: {
              "Content-Type": "text/css; charset=utf-8",
              "Cache-Control": "public, max-age=300",
            },
          });
        }

        // GET /n/:id  (viewer chrome + iframe)
        if (req.method === "GET" && path.startsWith("/n/")) {
          const id = path.slice(3);
          const note = getNoteMeta(id);
          if (!note) return htmlResp(pageError(404, `Note "${id}" not found.`), 404);
          logEvent("note_viewed", { source: "viewer" }, note.id, note.thread_id);
          return htmlResp(pageNote(note, note.theme));
        }

        // GET /raw/:id  (the actual HTML file, served raw for the iframe)
        // ?theme=X overrides the linked theme.css for preview only (does not mutate the file).
        //
        // Defense-in-depth: outer iframe is sandboxed without `allow-same-origin`
        // so the note is a null-origin document. On top of that:
        //   - script-src 'self' 'unsafe-inline' https: → scripts can run inline
        //     or load from any HTTPS CDN, but no http:/data:/javascript:.
        //   - connect-src 'none' → fetch/XHR/WebSocket blocked. The note cannot
        //     phone home or exfiltrate data even if a malicious script runs.
        //   - frame-ancestors 'self' → the note can only be framed by the
        //     viewer running on 127.0.0.1; other origins cannot reframe it.
        if (req.method === "GET" && path.startsWith("/raw/")) {
          const id = path.slice(5);
          const note = getNoteMeta(id);
          if (!note) return new Response("not found", { status: 404 });
          let html = readNoteHtml(note);
          const themeOverride = url.searchParams.get("theme");
          if (themeOverride && themeOverride !== note.theme && resolveTheme(themeOverride) !== null) {
            html = html.replace(
              /<link\s+rel="stylesheet"\s+href="\/themes\/[^"]+\/theme\.css">/,
              `<link rel="stylesheet" href="/themes/${themeOverride}/theme.css">`
            );
          }
          // Inject postMessage bootstrap so notes (including pre-v0.3 archive)
          // talk to the viewer chrome from inside their null-origin sandbox.
          html = injectBootstrap(html);
          return new Response(html, { headers: rawNoteHeaders() });
        }

        // GET /themes/:name/theme.css  (for hosted profile <link>)
        if (req.method === "GET" && path.startsWith("/themes/") && path.endsWith("/theme.css")) {
          const name = path.split("/")[2];
          const css = resolveTheme(name);
          if (!css) return new Response("/* theme not found */", { status: 404, headers: { "Content-Type": "text/css" } });
          return new Response(css, { headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=300" } });
        }

        // GET /stats
        if (req.method === "GET" && path === "/stats") {
          return htmlResp(pageStats(stats()));
        }

        // POST /api/notes/:id/finalize
        if (req.method === "POST" && /^\/api\/notes\/[^/]+\/finalize$/.test(path)) {
          const id = path.split("/")[3]!;
          const ok = finalize(id);
          if (!ok) return jsonResp({ error: "not found" }, 404);
          // Redirect back so HTML form submits feel native
          const ref = req.headers.get("referer");
          if (ref) return Response.redirect(ref, 303);
          return jsonResp({ ok: true });
        }

        // GET /api/list
        if (req.method === "GET" && path === "/api/list") {
          const type = url.searchParams.get("type") as NoteType | null;
          const thread = url.searchParams.get("thread");
          return jsonResp(listNotes({ type: type ?? undefined, thread_id: thread ?? undefined, limit: 200 }));
        }

        // GET /api/search
        if (req.method === "GET" && path === "/api/search") {
          const q = url.searchParams.get("q") ?? "";
          if (!q.trim()) return jsonResp([]);
          return jsonResp(searchNotes({ query: q, limit: 30 }));
        }

        // GET /api/stats
        if (req.method === "GET" && path === "/api/stats") {
          return jsonResp(stats());
        }

        // GET /api/threads
        if (req.method === "GET" && path === "/api/threads") {
          const q = url.searchParams.get("q") ?? "";
          return jsonResp(listThreads(q || undefined, 500));
        }

        // GET /api/tags — top tags with count (default ≥2)
        if (req.method === "GET" && path === "/api/tags") {
          const limit = Number(url.searchParams.get("limit") ?? 50);
          const min = Number(url.searchParams.get("min_count") ?? 2);
          return jsonResp(listPopularTags(Math.min(Math.max(1, limit), 500), Math.max(1, min)));
        }

        // GET /api/tag/:slug — notes for a single tag (JSON)
        if (req.method === "GET" && path.startsWith("/api/tag/")) {
          const tag = decodeURIComponent(path.slice(9));
          if (!tag) return jsonResp([]);
          return jsonResp(listNotesByTag(tag, 200));
        }

        // GET /health
        if (req.method === "GET" && path === "/health") {
          return jsonResp({ ok: true });
        }

        return htmlResp(pageError(404, `${req.method} ${path}`), 404);
      } catch (e: any) {
        console.error("Viewer error:", e);
        return htmlResp(pageError(500, e?.message ?? "internal error"), 500);
      }
    },
  });
  const localBase = `http://${server.hostname}:${server.port}`;
  const publicBase = viewerPublicBaseUrl(cfg);
  const publicNote = publicBase !== localBase ? `  (public: ${publicBase})` : "";
  console.log(`📄 Folio v${pkg.version} → ${localBase}${publicNote}`);
  console.log(`   Notes from: ${folioRoot()}`);
  return server;
}
