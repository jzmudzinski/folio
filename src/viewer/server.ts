import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, folioRoot, bundledThemesDir, themesDir } from "../core/config";
import { listNotes, searchNotes, getNoteMeta, readNoteHtml, stats, finalize, listThreads } from "../core/storage";
import { db, logEvent } from "../core/db";
import { pageList, pageSearch, pageThread, pageThreads, pageNote, pageStats, pageError } from "./render";
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

function resolveTheme(name: string): string | null {
  for (const root of [themesDir(), bundledThemesDir()]) {
    const p = join(root, name, "theme.css");
    if (existsSync(p)) return readFileSync(p, "utf-8");
  }
  return null;
}

export async function startServer(): Promise<void> {
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
          const finalOnly = url.searchParams.get("final") === "1";
          const expiring = url.searchParams.get("expiring") === "1";
          let notes = listNotes({
            type: type ?? undefined,
            is_final: finalOnly ? true : undefined,
            limit: 100,
          });
          if (expiring) {
            notes = notes.filter((n) => !n.is_final && n.expires_at && new Date(n.expires_at).getTime() - Date.now() < 7 * 86400000);
          }
          return htmlResp(pageList(notes, countSummary(), type ?? undefined, finalOnly ? "final" : expiring ? "expiring" : undefined));
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

        // GET /t/:thread_id
        if (req.method === "GET" && path.startsWith("/t/")) {
          const tid = decodeURIComponent(path.slice(3));
          const notes = listNotes({ thread_id: tid, limit: 200 });
          if (notes.length === 0) return htmlResp(pageError(404, `Thread "${tid}" not found.`), 404);
          return htmlResp(pageThread(tid, notes));
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
        if (req.method === "GET" && path.startsWith("/raw/")) {
          const id = path.slice(5);
          const note = getNoteMeta(id);
          if (!note) return new Response("not found", { status: 404 });
          const html = readNoteHtml(note);
          return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
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
  console.log(`📄 Folio viewer → http://${server.hostname}:${server.port}`);
  console.log(`   Notes from: ${folioRoot()}`);
}
