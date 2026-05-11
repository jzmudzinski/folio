import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

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
import { loadConfig } from "../core/config";
import { listThemes, getTheme } from "../core/themes";
import { db } from "../core/db";
import type { NoteType, RenderProfile } from "../core/types";

const ALLOWED_TYPES: NoteType[] = ["research", "comparison", "technical", "journal", "snippet"];
const ALLOWED_PROFILES: RenderProfile[] = ["hosted", "standalone"];

const tools: Tool[] = [
  {
    name: "folio.create",
    description:
      "Create a new Folio note (HTML communication artifact). Agents call this when they want to give the user a visually-rich response (research, comparison, technical doc). Note: append-only — you cannot edit; new iteration = new note in same thread.",
    inputSchema: {
      type: "object",
      required: ["type", "title", "body_html"],
      properties: {
        type: { type: "string", enum: ALLOWED_TYPES, description: "Note type. Pick `research` for deep dives, `comparison` for vs tables, `technical` for ADRs/specs, `journal` for chronological, `snippet` for short." },
        title: { type: "string", description: "Human-readable title (used as h1)." },
        body_html: { type: "string", description: "HTML fragment for the article body. NO <html>/<body>/<head>/<style>/<title>/<meta>; these come from template. Use semantic tags + theme utility classes (.eyebrow, .lead, .pill, .card, .verdict)." },
        thread_id: { type: "string", description: "Thread slug (kebab-case). Group related iterations. If omitted, slugified from title. PREFER calling folio.suggest_thread first to continue an existing thread instead of creating duplicates." },
        theme: { type: "string", description: "Theme name (default from user config, usually 'linen'). Call folio.list_themes to discover." },
        theme_profile: { type: "string", enum: ALLOWED_PROFILES, description: "'hosted' (default, links theme.css, ~50% less tokens) or 'standalone' (inline CSS, share-ready)." },
        tags: { type: "array", items: { type: "string" }, description: "Free-form tags." },
        is_final: { type: "boolean", description: "Mark as final (no auto-cleanup). User typically does this from viewer; agent only when explicitly asked." },
      },
    },
  },
  {
    name: "folio.get",
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
    name: "folio.list",
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
    name: "folio.search",
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
    name: "folio.finalize",
    description: "Mark a note as final — skip auto-cleanup. Use when user says 'keep this' or 'this is the right version'.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } },
    },
  },
  {
    name: "folio.suggest_thread",
    description: "Suggest existing thread_ids that match the title (FTS-based). CALL THIS BEFORE folio.create when you suspect the topic already has notes — to continue the thread instead of creating duplicates.",
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
    name: "folio.list_expiring",
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
    name: "folio.list_themes",
    description: "List available themes with name, source (bundled/user), summary, and best-for hints from theme.md.",
    inputSchema: { type: "object", properties: {} },
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
    { name: "folio", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, any>;

    try {
      switch (name) {
        case "folio.create": {
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

        case "folio.get": {
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

        case "folio.list": {
          const rows = listNotes({
            type: args.type as NoteType | undefined,
            thread_id: args.thread_id ? String(args.thread_id) : undefined,
            is_final: typeof args.is_final === "boolean" ? args.is_final : undefined,
            limit: Math.min(typeof args.limit === "number" ? args.limit : 50, 200),
          });
          return jsonContent(rows);
        }

        case "folio.search": {
          if (!args.query) return errContent("Missing query");
          const hits = searchNotes({
            query: String(args.query),
            type: args.type as NoteType | undefined,
            limit: Math.min(typeof args.limit === "number" ? args.limit : 20, 100),
          });
          return jsonContent(hits);
        }

        case "folio.finalize": {
          const id = String(args.id ?? "");
          if (!id) return errContent("Missing id");
          const ok = finalize(id);
          if (!ok) return errContent(`Not found: ${id}`);
          return jsonContent({ ok: true, id });
        }

        case "folio.suggest_thread": {
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

        case "folio.list_expiring": {
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

        case "folio.list_themes": {
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

        default:
          return errContent(`Unknown tool: ${name}`);
      }
    } catch (e: any) {
      return errContent(`Error in ${name}: ${e?.message ?? String(e)}`);
    }
  });

  return server;
}

export async function startStdioServer(): Promise<void> {
  const server = await buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Keep alive; transport handles stdio lifecycle.
}
