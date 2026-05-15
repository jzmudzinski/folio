import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, folioRoot, bundledThemesDir, themesDir, viewerPublicBaseUrl, threadAssetsDir, isSafeAssetFilename } from "../core/config";
import { listNotes, searchNotes, getNoteMeta, readNoteHtml, stats, finalize, deleteNote, listThreads, listPopularTags, listNotesByTag, listProjectThreads } from "../core/storage";
import { db, logEvent } from "../core/db";
import { pageList, pageSearch, pageThread, pageThreads, pageNote, pageStats, pageError, pageTag, pageCloud, pageShares, pageProject } from "./render";
import { injectBootstrap } from "./note-bootstrap";
import { rawNoteHeaders } from "../core/csp";
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
        // Favicon — both /favicon.svg (modern, what the <link> in shell()
        // points at) and /favicon.ico (legacy browser auto-request). Both
        // serve the same SVG with image/svg+xml content-type. Chrome / Safari
        // / Firefox accept SVG via the .ico path; older browsers silently
        // fail to render which is fine — the <link> tag wins in modern UAs.
        if (req.method === "GET" && (path === "/favicon.svg" || path === "/favicon.ico")) {
          const { FOLIO_ICON_SVG } = await import("../core/brand");
          return new Response(FOLIO_ICON_SVG, {
            headers: {
              "Content-Type": "image/svg+xml; charset=utf-8",
              "Cache-Control": "public, max-age=86400, immutable",
            },
          });
        }

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

        // GET /p/:slug — project workspace view (v0.20+)
        //   Groups every note tagged `project:<slug>` by thread_id. One
        //   card per thread, showing note count + latest activity + final
        //   count. The maps-to-Obsidian-folder mental model for users
        //   running multi-thread projects in Folio. Empty state when no
        //   notes carry the tag — tells the user to ask the agent to add it.
        if (req.method === "GET" && path.startsWith("/p/")) {
          const slug = decodeURIComponent(path.slice(3));
          if (!slug) return Response.redirect("/", 302);
          const { groups, totalNotes } = listProjectThreads(slug);
          return htmlResp(pageProject(slug, groups, totalNotes));
        }

        // GET /api/p/:slug — JSON variant for tooling
        if (req.method === "GET" && path.startsWith("/api/p/")) {
          const slug = decodeURIComponent(path.slice(7));
          if (!slug) return jsonResp({ error: "slug required" }, 400);
          return jsonResp(listProjectThreads(slug));
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

        // GET /n/:id/shares  (manage shares page, v0.19+)
        // Must come BEFORE the generic /n/:id route below since startsWith
        // would otherwise swallow it. Fetches active shares from the cloud
        // for the current device's user partition; empty/unpaired states
        // are rendered inline by pageShares.
        if (req.method === "GET" && /^\/n\/[^/]+\/shares$/.test(path)) {
          const id = path.split("/")[2]!;
          const note = getNoteMeta(id);
          if (!note) return htmlResp(pageError(404, `Note "${id}" not found.`), 404);
          const { loadSyncState } = await import("../core/sync");
          const state = loadSyncState();
          let shares: any[] = [];
          let paired = false;
          if (state) {
            paired = true;
            try {
              const res = await fetch(`${state.remote}/v1/shares?scope_id=${encodeURIComponent(id)}`, {
                headers: { Authorization: `Bearer ${state.device_token}` },
              });
              if (res.ok) {
                const data = (await res.json()) as { shares?: any[] };
                shares = data.shares ?? [];
              }
            } catch {
              // Network/cloud errors render as empty list. Browser console
              // logs nothing; the page just shows "no shares" rather than
              // a blocking error. Operator workflow: check /cloud.
            }
          }
          return htmlResp(pageShares(note, shares, paired));
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
          // v0.17: inline-rendered live notes — splice current feed entries
          // into <section data-folio-live-feed> and append the postMessage
          // bootstrap so new entries land in real time from parent SSE.
          if (note.live && note.inline_render && !note.is_final) {
            const { entriesPath, readEntries, compileRendered } = await import("../core/live");
            const { renderFeedHtml, spliceFeedIntoBody, INLINE_FEED_BOOTSTRAP_JS } = await import("../core/feed-render");
            const jsonl = entriesPath(join(folioRoot(), note.path));
            const entries = readEntries(jsonl);
            const compiled = compileRendered(entries);
            const feedHtml = renderFeedHtml(compiled);
            // Splice into the article body, then append the bootstrap script
            // just before </body> so it runs after the DOM is in place.
            html = html.replace(
              /(<article[^>]*data-folio-content[^>]*>)([\s\S]*?)(<\/article>)/,
              (_m, open, content, close) => `${open}${spliceFeedIntoBody(content, feedHtml)}${close}`
            );
            html = html.replace("</body>", `<script>${INLINE_FEED_BOOTSTRAP_JS}</script></body>`);
          }
          // v0.18: iteration notes — swap the article body for a server-
          // rendered gallery built from the JSONL state machine. Chrome
          // (h1/intro from agent's body_html) survives via extractChrome.
          // Once finalized, fall through to the normal rendering path.
          if (note.type === "iteration" && !note.is_final) {
            const { renderIterationRaw, extractChrome } = await import("./iteration-render");
            const { getIterationState } = await import("../core/iteration");
            const state = getIterationState(note.id);
            if (state) {
              const chrome = extractChrome(html);
              const iterFragment = renderIterationRaw({
                noteId: note.id,
                title: note.title,
                chromeHtml: chrome,
                state,
              });
              html = html.replace(
                /(<article[^>]*data-folio-content[^>]*>)([\s\S]*?)(<\/article>)/,
                (_m, open, _content, close) => `${open}${iterFragment}${close}`
              );
            }
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

        // GET /cloud — sync + cloud pairing UI
        if (req.method === "GET" && path === "/cloud") {
          const { loadSyncState } = await import("../core/sync");
          const { getOrCreateDeviceId } = await import("../core/config");
          const state = loadSyncState();
          const dev = getOrCreateDeviceId();
          if (!state) {
            return htmlResp(pageCloud({ paired: false }));
          }
          return htmlResp(pageCloud({
            paired: true,
            remote: state.remote,
            device_id: dev.id,
            device_name: dev.name,
            last_pushed_at: state.last_pushed_at,
            last_pulled_seq: state.last_pulled_seq,
            live_notes_tracked: Object.keys(state.last_live_pushed ?? {}).length,
          }));
        }

        // GET /api/sync/state — JSON sync state (token redacted)
        if (req.method === "GET" && path === "/api/sync/state") {
          const { loadSyncState } = await import("../core/sync");
          const { getOrCreateDeviceId } = await import("../core/config");
          const state = loadSyncState();
          const dev = getOrCreateDeviceId();
          if (!state) return jsonResp({ paired: false, device_id: dev.id, device_name: dev.name });
          return jsonResp({
            paired: true,
            remote: state.remote,
            device_id: dev.id,
            device_name: dev.name,
            last_pushed_at: state.last_pushed_at,
            last_pulled_seq: state.last_pulled_seq,
            live_notes_tracked: Object.keys(state.last_live_pushed ?? {}).length,
          });
        }

        // POST /api/sync/pair  { remote, code, device_name? }
        // Calls the cloud's /v1/auth/pair using THIS device's local id, so the
        // cloud and the laptop agree on origin_device_id from the start.
        // Token is persisted to ~/Folio/.sync-state.json and never leaves
        // this process otherwise.
        if (req.method === "POST" && path === "/api/sync/pair") {
          const body = await req.json().catch(() => ({})) as any;
          const remote = String(body.remote ?? "").trim().replace(/\/+$/, "");
          const code = String(body.code ?? "").trim();
          if (!remote || !code) return jsonResp({ error: "remote and code required" }, 400);
          const { getOrCreateDeviceId } = await import("../core/config");
          const dev = getOrCreateDeviceId();
          const name = String(body.device_name ?? "").trim() || dev.name;
          const res = await fetch(`${remote}/v1/auth/pair`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ code, device_name: name, device_id: dev.id }),
          });
          if (!res.ok) {
            let detail = ""; try { detail = await res.text(); } catch {}
            return jsonResp({ error: `pair failed: HTTP ${res.status} ${detail.slice(0, 200)}` }, 502);
          }
          const out = (await res.json()) as { device_id: string; token: string };
          const { saveSyncState } = await import("../core/sync");
          saveSyncState({
            remote,
            device_token: out.token,
            last_pulled_seq: 0,
            last_pushed_at: null,
            last_live_pushed: {},
          });
          return jsonResp({ ok: true, device_id: out.device_id });
        }

        // POST /api/sync/pair-code — already paired? ask the cloud for a new
        // pairing code so another device can onboard without SSH.
        if (req.method === "POST" && path === "/api/sync/pair-code") {
          const { loadSyncState } = await import("../core/sync");
          const state = loadSyncState();
          if (!state) return jsonResp({ error: "not paired" }, 400);
          const res = await fetch(`${state.remote}/v1/auth/pair-code`, {
            method: "POST",
            headers: { Authorization: `Bearer ${state.device_token}` },
          });
          if (!res.ok) {
            let detail = ""; try { detail = await res.text(); } catch {}
            return jsonResp({ error: `pair-code failed: HTTP ${res.status} ${detail.slice(0, 200)}` }, 502);
          }
          const body = await res.json();
          return jsonResp(body);
        }

        // GET /api/cloud/stats — proxy to cloud /v1/admin/stats with the
        // device bearer token from local sync state. Keeps the token out of
        // page JS — only the local viewer process holds it.
        if (req.method === "GET" && path === "/api/cloud/stats") {
          const { loadSyncState } = await import("../core/sync");
          const state = loadSyncState();
          if (!state) return jsonResp({ error: "not paired" }, 400);
          try {
            const res = await fetch(`${state.remote}/v1/admin/stats`, {
              headers: { Authorization: `Bearer ${state.device_token}` },
            });
            if (!res.ok) {
              let detail = ""; try { detail = await res.text(); } catch {}
              return jsonResp({ error: `stats failed: HTTP ${res.status} ${detail.slice(0, 200)}` }, 502);
            }
            return jsonResp(await res.json());
          } catch (e: any) {
            return jsonResp({ error: e?.message ?? String(e) }, 502);
          }
        }

        // ---- /api/cloud/admin/* mirror routes (v0.14+) ----
        // Same bearer-laundering pattern as /api/cloud/stats: the viewer
        // process holds the token from .sync-state.json and proxies the
        // request body straight through. Page JS calls these with no auth
        // headers; the cloud's operator gate handles authorization.
        if (path.startsWith("/api/cloud/admin/")) {
          const { loadSyncState } = await import("../core/sync");
          const state = loadSyncState();
          if (!state) return jsonResp({ error: "not paired" }, 400);
          const cloudPath = path.replace("/api/cloud/admin/", "/v1/admin/");
          const cloudUrl = state.remote + cloudPath + (url.search || "");
          const init: RequestInit = {
            method: req.method,
            headers: {
              Authorization: `Bearer ${state.device_token}`,
              "Content-Type": "application/json",
            },
          };
          if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "DELETE") {
            try {
              (init as any).body = await req.text();
            } catch {
              (init as any).body = "";
            }
          }
          try {
            const res = await fetch(cloudUrl, init);
            const body = await res.text();
            return new Response(body, {
              status: res.status,
              headers: { "Content-Type": "application/json; charset=utf-8" },
            });
          } catch (e: any) {
            return jsonResp({ error: e?.message ?? String(e) }, 502);
          }
        }

        // POST /api/notes/:id/iter/pick  { variant_id }  (v0.18+)
        //   Iteration notes: viewer's click-to-pick endpoint. Body is the
        //   same shape as the MCP pick_variant tool would receive.
        if (req.method === "POST" && /^\/api\/notes\/[^/]+\/iter\/pick$/.test(path)) {
          const id = path.split("/")[3]!;
          const body = await req.json().catch(() => ({})) as { variant_id?: string };
          if (!body.variant_id) return jsonResp({ error: "variant_id required" }, 400);
          try {
            const { pickVariant } = await import("../core/iteration");
            const result = pickVariant({ note_id: id, variant_id: body.variant_id });
            return jsonResp(result);
          } catch (e: any) {
            return jsonResp({ error: e?.message ?? String(e) }, 400);
          }
        }

        // GET /api/notes/:id/iter/state — JSON snapshot of iteration state.
        if (req.method === "GET" && /^\/api\/notes\/[^/]+\/iter\/state$/.test(path)) {
          const id = path.split("/")[3]!;
          const { getIterationState } = await import("../core/iteration");
          const state = getIterationState(id);
          if (!state) return jsonResp({ error: "not found or not an iteration note" }, 404);
          return jsonResp(state);
        }

        // ─── Share endpoints (v0.19+) ─────────────────────────────────────
        // The viewer proxies the cloud's share API (/v1/share + /v1/shares)
        // so the browser UI can publish, list, and revoke without the user
        // touching a CLI. Auth comes from ~/Folio/.sync-state.json — the
        // same source the `folio publish` CLI uses. Cloud-not-paired returns
        // 412 with a structured error so the UI can guide the user.

        // POST /api/notes/:id/shares — create a new capability URL.
        // Body: { expires_in_days?, max_views?, recipient? } (recipient is
        // hashed locally per ADR; cloud only sees the hash + optional
        // plaintext for one-shot mailer delivery).
        if (req.method === "POST" && /^\/api\/notes\/[^/]+\/shares$/.test(path)) {
          const id = path.split("/")[3]!;
          const note = getNoteMeta(id);
          if (!note) return jsonResp({ error: "note not found" }, 404);
          const { loadSyncState } = await import("../core/sync");
          const state = loadSyncState();
          if (!state) return jsonResp({ error: "cloud not paired", code: "NOT_PAIRED" }, 412);
          const body = await req.json().catch(() => ({})) as {
            expires_in_days?: number;
            max_views?: number | null;
            recipient?: string;
          };
          const payload: Record<string, unknown> = {
            scope_type: "note",
            scope_id: id,
            expires_in_days: body.expires_in_days ?? 7,
            max_views: body.max_views ?? null,
          };
          if (body.recipient && body.recipient.trim()) {
            const { recipientEmailHash } = await import("../cli/commands/publish");
            const plain = body.recipient.trim().toLowerCase();
            payload.recipient_email_hash = recipientEmailHash(plain);
            payload.recipient_email = plain;
          }
          const res = await fetch(`${state.remote}/v1/share`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${state.device_token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(payload),
          });
          if (!res.ok) {
            let detail = ""; try { detail = await res.text(); } catch {}
            return jsonResp({ error: `cloud rejected: HTTP ${res.status} ${detail.slice(0, 200)}` }, 502);
          }
          return jsonResp(await res.json());
        }

        // GET /api/notes/:id/shares — list active shares for this note.
        if (req.method === "GET" && /^\/api\/notes\/[^/]+\/shares$/.test(path)) {
          const id = path.split("/")[3]!;
          const note = getNoteMeta(id);
          if (!note) return jsonResp({ error: "note not found" }, 404);
          const { loadSyncState } = await import("../core/sync");
          const state = loadSyncState();
          // Not-paired: return empty list rather than 412 here — GET is
          // called eagerly on page load by the active-dot indicator, and
          // a 412 every page load would noise up the console for solo-use
          // (non-paired) workflows.
          if (!state) return jsonResp({ paired: false, shares: [] });
          const res = await fetch(`${state.remote}/v1/shares?scope_id=${encodeURIComponent(id)}`, {
            headers: { Authorization: `Bearer ${state.device_token}` },
          });
          if (!res.ok) {
            return jsonResp({ paired: true, shares: [], error: `cloud HTTP ${res.status}` });
          }
          const data = (await res.json()) as { shares: unknown[] };
          return jsonResp({ paired: true, shares: data.shares });
        }

        // DELETE /api/notes/:id/shares/:token — revoke a share.
        if (req.method === "DELETE" && /^\/api\/notes\/[^/]+\/shares\/[A-Za-z0-9_\-]+$/.test(path)) {
          const parts = path.split("/");
          const id = parts[3]!;
          const token = parts[5]!;
          const note = getNoteMeta(id);
          if (!note) return jsonResp({ error: "note not found" }, 404);
          const { loadSyncState } = await import("../core/sync");
          const state = loadSyncState();
          if (!state) return jsonResp({ error: "cloud not paired", code: "NOT_PAIRED" }, 412);
          const res = await fetch(`${state.remote}/v1/share/${encodeURIComponent(token)}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${state.device_token}` },
          });
          if (!res.ok) {
            let detail = ""; try { detail = await res.text(); } catch {}
            return jsonResp({ error: `cloud rejected: HTTP ${res.status} ${detail.slice(0, 200)}` }, 502);
          }
          return jsonResp(await res.json());
        }

        // POST /api/sync/run — one-shot sync (mirrors `folio sync --once`)
        if (req.method === "POST" && path === "/api/sync/run") {
          const { loadSyncState, syncOnce } = await import("../core/sync");
          const state = loadSyncState();
          if (!state) return jsonResp({ error: "not paired" }, 400);
          try {
            const result = await syncOnce(state);
            return jsonResp(result);
          } catch (e: any) {
            return jsonResp({ error: e?.message ?? String(e) }, 500);
          }
        }

        // POST /api/sync/unpair — clears local state. Best-effort revoke on
        // cloud. After this, /cloud renders the not-paired form again.
        if (req.method === "POST" && path === "/api/sync/unpair") {
          const { loadSyncState } = await import("../core/sync");
          const state = loadSyncState();
          if (!state) return jsonResp({ ok: true, note: "was not paired" });
          // Best-effort revoke: list devices, find one with matching name,
          // DELETE it. Network/auth errors don't block local cleanup.
          try {
            const listRes = await fetch(`${state.remote}/v1/auth/devices`, {
              headers: { Authorization: `Bearer ${state.device_token}` },
            });
            if (listRes.ok) {
              const { getOrCreateDeviceId } = await import("../core/config");
              const dev = getOrCreateDeviceId();
              const { devices } = (await listRes.json()) as { devices: { id: string; name: string }[] };
              const me = devices.find((d) => d.id === dev.id) ?? devices.find((d) => d.name === dev.name);
              if (me) {
                await fetch(`${state.remote}/v1/auth/device/${me.id}`, {
                  method: "DELETE",
                  headers: { Authorization: `Bearer ${state.device_token}` },
                });
              }
            }
          } catch {}
          const { unlinkSync } = await import("node:fs");
          const statePath = `${folioRoot()}/.sync-state.json`;
          try { unlinkSync(statePath); } catch {}
          return jsonResp({ ok: true });
        }

        // POST /api/notes/:id/delete  (soft-delete; mirrors `folio delete <id>`)
        // Same semantics as the CLI: file moves to ~/Folio/.trash/<id>/,
        // status='trashed', FTS row removed. Recoverable for 7 days via the
        // cleanup grace window. Sync daemon propagates the delete to cloud
        // on next run; viewer doesn't talk to the cloud directly here.
        if (req.method === "POST" && /^\/api\/notes\/[^/]+\/delete$/.test(path)) {
          const id = path.split("/")[3]!;
          const res = deleteNote(id);
          if (!res.ok) return jsonResp({ error: res.reason ?? "delete failed" }, 404);
          // The deleted note's URL is now stale, so don't redirect back to it.
          // Send the caller to the thread index. JS callers can ignore and
          // navigate themselves.
          const note = getNoteMeta(id);
          if (note) return jsonResp({ deleted: id });
          // After delete, getNoteMeta returns null (filters status='active').
          // Pull the thread from the original side-channel header if present.
          const fallback = req.headers.get("x-folio-thread");
          return jsonResp({ deleted: id, thread_redirect: fallback ?? "/" });
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
