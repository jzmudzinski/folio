import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  type Tool,
  type Resource,
} from "@modelcontextprotocol/sdk/types.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };

import {
  createNote,
  getNoteMeta,
  readNoteHtml,
  listNotes,
  searchNotes,
  finalize,
  listThreads,
  suggestThread,
  stats,
} from "../core/storage";
import { loadConfig, folioRoot, bundledThemesDir, themesDir } from "../core/config";
import { listThemes, getTheme } from "../core/themes";
import { db } from "../core/db";
import type { NoteType, RenderProfile } from "../core/types";

const ALLOWED_TYPES: NoteType[] = ["research", "comparison", "technical", "journal", "snippet"];
const ALLOWED_PROFILES: RenderProfile[] = ["hosted", "standalone"];

const tools: Tool[] = [
  {
    name: "create",
    description:
      "Create a new Folio note (HTML communication artifact). Agents call this when they want to give the user a visually-rich response (research, comparison, technical doc). Note: append-only — you cannot edit; new iteration = new note in same thread.",
    inputSchema: {
      type: "object",
      required: ["type", "title", "body_html"],
      properties: {
        type: { type: "string", enum: ALLOWED_TYPES, description: "Note type. Pick `research` for deep dives, `comparison` for vs tables, `technical` for ADRs/specs, `journal` for chronological, `snippet` for short." },
        title: { type: "string", description: "Human-readable title (used as h1)." },
        body_html: { type: "string", description: "HTML fragment for the article body. NO <html>/<body>/<head>/<style>/<title>/<meta>; these come from template. Use semantic tags + theme utility classes (.eyebrow, .lead, .pill, .card, .verdict)." },
        thread_id: { type: "string", description: "Thread slug (kebab-case). Group related iterations. If omitted, slugified from title. PREFER calling suggest_thread first to continue an existing thread instead of creating duplicates." },
        theme: { type: "string", description: "Theme name (default from user config, usually 'linen'). Call list_themes to discover." },
        theme_profile: { type: "string", enum: ALLOWED_PROFILES, description: "'hosted' (default, links theme.css, ~50% less tokens) or 'standalone' (inline CSS, share-ready)." },
        tags: { type: "array", items: { type: "string" }, description: "Free-form tags." },
        is_final: { type: "boolean", description: "Mark as final (no auto-cleanup). User typically does this from viewer; agent only when explicitly asked." },
      },
    },
  },
  {
    name: "get",
    description: "Read a note's metadata and body HTML.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        include_body: { type: "boolean", description: "Include full body_html (default true)." },
      },
    },
  },
  {
    name: "list",
    description: "List recent notes with optional filters.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ALLOWED_TYPES },
        thread_id: { type: "string" },
        is_final: { type: "boolean" },
        limit: { type: "number", description: "Default 50, max 200." },
      },
    },
  },
  {
    name: "search",
    description: "Full-text search across all notes (FTS5 BM25 with field weighting: title ×5, headings ×3, tags ×4, body ×1).",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string" },
        type: { type: "string", enum: ALLOWED_TYPES },
        limit: { type: "number", description: "Default 20." },
      },
    },
  },
  {
    name: "finalize",
    description: "Mark a note as final — skip auto-cleanup. Use when user says 'keep this' or 'this is the right version'.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } },
    },
  },
  {
    name: "suggest_thread",
    description: "Suggest existing thread_ids that match the title (FTS-based). CALL THIS BEFORE create when you suspect the topic already has notes — to continue the thread instead of creating duplicates.",
    inputSchema: {
      type: "object",
      required: ["title"],
      properties: {
        title: { type: "string" },
        type: { type: "string", enum: ALLOWED_TYPES },
        limit: { type: "number", description: "Default 5." },
      },
    },
  },
  {
    name: "list_expiring",
    description: "List non-final notes that will be auto-deleted soon. Use to proactively warn the user (gated heuristics in Skill).",
    inputSchema: {
      type: "object",
      properties: {
        within_days: { type: "number", description: "Default 7." },
        limit: { type: "number", description: "Default 10." },
      },
    },
  },
  {
    name: "list_themes",
    description: "List available themes with name, source (bundled/user), summary, and best-for hints from theme.md.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "export",
    description: "Export a note as a single self-contained HTML document. Use this when the user asks to share / download / send a note — agent gets back the full HTML string ready to paste, save, or pipe further. The note file on disk is NOT modified.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        profile: { type: "string", enum: ["standalone", "hosted"], description: "'standalone' (default) inlines theme.css so the file works offline; 'hosted' keeps the <link> tag and only makes sense within a running viewer." },
      },
    },
  },
  {
    name: "unfinalize",
    description: "Reverse a finalize: re-enable auto-cleanup countdown on a note. Use sparingly — only when user explicitly says 'this isn't the right version after all'. Sets expires_at = created + default_lifespan and is_final=false.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } },
    },
  },
];

function jsonContent(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}
function errContent(msg: string) {
  return { content: [{ type: "text" as const, text: msg }], isError: true };
}

function pickFirstLine(s: string, maxLen = 140): string {
  const line = s.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  return line.replace(/^#+\s*/, "").slice(0, maxLen).trim();
}

export async function buildServer(): Promise<Server> {
  const server = new Server(
    { name: "folio", version: pkg.version },
    { capabilities: { tools: {}, resources: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, any>;

    try {
      switch (name) {
        case "create": {
          if (!args.type || !args.title || !args.body_html) {
            return errContent("Missing required: type, title, body_html");
          }
          if (!ALLOWED_TYPES.includes(args.type)) {
            return errContent(`Invalid type. One of: ${ALLOWED_TYPES.join(", ")}`);
          }
          const note = await createNote({
            type: args.type,
            title: String(args.title),
            body_html: String(args.body_html),
            thread_id: args.thread_id ? String(args.thread_id) : undefined,
            theme: args.theme ? String(args.theme) : undefined,
            theme_profile: args.theme_profile ? (String(args.theme_profile) as RenderProfile) : undefined,
            tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
            is_final: typeof args.is_final === "boolean" ? args.is_final : undefined,
          });
          const cfg = await loadConfig();
          return jsonContent({
            id: note.id,
            slug: note.slug,
            path: note.path,
            local_url: `http://${cfg.viewer_host}:${cfg.viewer_port}/n/${note.id}`,
            thread_id: note.thread_id,
            theme: note.theme,
            theme_profile: note.theme_profile,
            expires_at: note.expires_at,
            // Hint to agent: include in MEDIA: response convention
            response_hint: `Respond to user with: "MEDIA:http://${cfg.viewer_host}:${cfg.viewer_port}/n/${note.id}" + 3-5 line TL;DR.`,
          });
        }

        case "get": {
          const id = String(args.id ?? "");
          if (!id) return errContent("Missing id");
          const note = getNoteMeta(id);
          if (!note) return errContent(`Not found: ${id}`);
          const includeBody = args.include_body !== false;
          if (!includeBody) return jsonContent(note);
          const html = readNoteHtml(note);
          // Extract just the <article> body for agent consumption (cheaper than full doc)
          const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/);
          const body_html = articleMatch ? articleMatch[1].trim() : html;
          return jsonContent({ ...note, body_html });
        }

        case "list": {
          const rows = listNotes({
            type: args.type as NoteType | undefined,
            thread_id: args.thread_id ? String(args.thread_id) : undefined,
            is_final: typeof args.is_final === "boolean" ? args.is_final : undefined,
            limit: Math.min(typeof args.limit === "number" ? args.limit : 50, 200),
          });
          return jsonContent(rows);
        }

        case "search": {
          if (!args.query) return errContent("Missing query");
          const hits = searchNotes({
            query: String(args.query),
            type: args.type as NoteType | undefined,
            limit: Math.min(typeof args.limit === "number" ? args.limit : 20, 100),
          });
          return jsonContent(hits);
        }

        case "finalize": {
          const id = String(args.id ?? "");
          if (!id) return errContent("Missing id");
          const ok = finalize(id);
          if (!ok) return errContent(`Not found: ${id}`);
          return jsonContent({ ok: true, id });
        }

        case "suggest_thread": {
          const title = String(args.title ?? "");
          if (!title) return errContent("Missing title");
          const limit = typeof args.limit === "number" ? args.limit : 5;
          const found = suggestThread(title, limit);
          if (found.length === 0) {
            // Also offer the auto-slug that would be created
            const { slugify } = await import("../core/slug");
            return jsonContent({
              matches: [],
              proposed_new_thread: slugify(title),
              note: "No matching thread found. If you continue, a new thread will be created with this slug.",
            });
          }
          return jsonContent({ matches: found });
        }

        case "list_expiring": {
          const within_days = typeof args.within_days === "number" ? args.within_days : 7;
          const limit = typeof args.limit === "number" ? args.limit : 10;
          const rows = db()
            .query<any, [number]>(
              `SELECT id, slug, title, type, thread_id, created, expires_at,
                      CAST(julianday(expires_at) - julianday('now') AS INTEGER) AS days_left
               FROM notes
               WHERE status='active' AND is_final = 0 AND expires_at IS NOT NULL
                 AND expires_at < datetime('now', '+' || ? || ' days')
               ORDER BY expires_at ASC
               LIMIT ?`
            )
            .all(within_days, limit);
          return jsonContent(rows);
        }

        case "list_themes": {
          const list = listThemes();
          const detailed = await Promise.all(
            list.map(async (t) => {
              const full = await getTheme(t.name);
              return {
                name: t.name,
                source: t.source,
                summary: pickFirstLine(full?.prompt ?? "", 200),
                prompt_addendum: full?.prompt ?? "",
              };
            })
          );
          return jsonContent({
            default: (await loadConfig()).theme,
            themes: detailed,
          });
        }

        case "export": {
          const id = String(args.id ?? "");
          if (!id) return errContent("Missing id");
          const note = getNoteMeta(id);
          if (!note) return errContent(`Not found: ${id}`);
          const profile = (String(args.profile ?? "standalone")) as RenderProfile;
          let html = readNoteHtml(note);
          if (profile === "standalone") {
            // Inline theme.css instead of <link>
            const themeName = note.theme;
            let css: string | null = null;
            for (const root of [themesDir(), bundledThemesDir()]) {
              const p = join(root, themeName, "theme.css");
              if (existsSync(p)) { css = readFileSync(p, "utf-8"); break; }
            }
            if (css) {
              const linkRx = /<link\s+rel="stylesheet"\s+href="\/themes\/[^"]+\/theme\.css">/;
              if (linkRx.test(html)) {
                html = html.replace(linkRx, `<style>\n${css}\n</style>`);
              } else if (!/<style>/.test(html)) {
                html = html.replace(/<\/head>/, `<style>\n${css}\n</style>\n</head>`);
              }
            }
          }
          return jsonContent({
            id: note.id,
            slug: note.slug,
            title: note.title,
            profile,
            size_kb: Math.round(html.length / 1024),
            html,
          });
        }

        case "unfinalize": {
          const id = String(args.id ?? "");
          if (!id) return errContent("Missing id");
          const note = getNoteMeta(id);
          if (!note) return errContent(`Not found: ${id}`);
          if (!note.is_final) return jsonContent({ ok: false, id, note: "Already not final, no change." });
          const cfg = await loadConfig();
          // Re-arm expiry: created + default_lifespan
          db().run(
            "UPDATE notes SET is_final = 0, expires_at = datetime(?, '+' || ? || ' days'), updated = datetime('now') WHERE id = ?",
            [note.created, cfg.default_lifespan_days, id]
          );
          // Log event for analytics
          db().run(
            "INSERT INTO events (ts, kind, note_id, thread_id, data) VALUES (?, ?, ?, ?, ?)",
            [new Date().toISOString(), "note_unfinalized", id, note.thread_id, JSON.stringify({ via: "mcp" })]
          );
          return jsonContent({ ok: true, id, expires_at_reset_to: `created + ${cfg.default_lifespan_days} days` });
        }

        default:
          return errContent(`Unknown tool: ${name}`);
      }
    } catch (e: any) {
      return errContent(`Error in ${name}: ${e?.message ?? String(e)}`);
    }
  });

  // ──────────────  RESOURCES  ──────────────
  // Folio exposes a small set of read-only resources for context-loading
  // without invoking tools. Useful when an agent wants to "browse" before deciding.
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const cfg = await loadConfig();
    const resources: Resource[] = [
      { uri: "folio://recent", name: "Recent notes", description: `${cfg.viewer_host} most-recent 20 notes (metadata only)`, mimeType: "application/json" },
      { uri: "folio://final", name: "Final notes", description: "All notes marked is_final=true", mimeType: "application/json" },
      { uri: "folio://expiring", name: "Expiring soon", description: "Non-final notes within 7d of auto-delete", mimeType: "application/json" },
      { uri: "folio://threads", name: "All threads", description: "Thread index with counts + final markers", mimeType: "application/json" },
    ];
    // Plus each thread as its own resource
    const threads = listThreads(undefined, 100);
    for (const t of threads) {
      resources.push({
        uri: `folio://thread/${t.thread_id}`,
        name: `Thread: ${t.thread_id}`,
        description: `${t.count} notes${t.final_count > 0 ? ` (${t.final_count} final)` : ""}`,
        mimeType: "application/json",
      });
    }
    return { resources };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const uri = req.params.uri;
    const respond = (payload: unknown) => ({
      contents: [{ uri, mimeType: "application/json", text: JSON.stringify(payload, null, 2) }],
    });

    if (uri === "folio://recent") return respond(listNotes({ limit: 20 }));
    if (uri === "folio://final") return respond(listNotes({ is_final: true, limit: 100 }));
    if (uri === "folio://threads") return respond(listThreads(undefined, 200));
    if (uri === "folio://expiring") {
      const rows = db()
        .query<any, []>(
          `SELECT id, slug, title, type, thread_id, created, expires_at,
                  CAST(julianday(expires_at) - julianday('now') AS INTEGER) AS days_left
           FROM notes
           WHERE status='active' AND is_final = 0 AND expires_at IS NOT NULL
             AND expires_at < datetime('now', '+7 days')
           ORDER BY expires_at ASC`
        )
        .all();
      return respond(rows);
    }
    const threadMatch = uri.match(/^folio:\/\/thread\/(.+)$/);
    if (threadMatch) {
      const tid = decodeURIComponent(threadMatch[1]!);
      const notes = listNotes({ thread_id: tid, limit: 200 });
      return respond({ thread_id: tid, count: notes.length, notes });
    }
    throw new Error(`Unknown resource: ${uri}`);
  });

  return server;
}

export async function startStdioServer(): Promise<void> {
  const server = await buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Keep alive; transport handles stdio lifecycle.
}
