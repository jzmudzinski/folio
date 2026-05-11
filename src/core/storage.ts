import { ulid } from "ulid";
import { existsSync, mkdirSync, renameSync, writeFileSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { db, logEvent } from "./db";
import { folioRoot, threadsDir, notesDir, loadConfig } from "./config";
import { slugify } from "./slug";
import { sanitize } from "./sanitize";
import { extractText } from "./text";
import { renderNote } from "./templates";
import { getTheme } from "./themes";
import type { CreateNoteInput, NoteMeta, SearchHit, NoteType, RenderProfile } from "./types";

function isoNow(): string {
  return new Date().toISOString();
}

function isoPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function ensureDir(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function uniqueSlug(slug: string, dir: string): string {
  let candidate = slug;
  let n = 2;
  while (existsSync(join(dir, `${candidate}.html`))) {
    candidate = `${slug}-${n}`;
    n++;
  }
  return candidate;
}

export async function createNote(input: CreateNoteInput): Promise<NoteMeta> {
  const cfg = await loadConfig();
  const theme = input.theme ?? cfg.theme;
  const theme_profile: RenderProfile = input.theme_profile ?? "hosted";
  const thread_id = input.thread_id ?? slugify(input.title);
  const slugBase = slugify(input.title);

  // Sanitize body
  const { html: cleanBody, drops } = sanitize(input.body_html);

  // Extract text for FTS + analytics
  const stats = extractText(cleanBody);

  // Theme CSS (for standalone profile only; hosted resolves at serve time)
  const themeObj = await getTheme(theme);
  if (!themeObj) throw new Error(`Theme not found: ${theme}`);

  // ID + paths
  const id = ulid();
  const targetDir = join(threadsDir(), thread_id);
  ensureDir(targetDir);
  const slug = uniqueSlug(slugBase, targetDir);
  const filePath = join(targetDir, `${slug}.html`);
  const created = isoNow();
  const is_final = input.is_final ?? false;
  const expires_at = is_final ? null : isoPlusDays(cfg.default_lifespan_days);

  // Render full HTML
  const fullHtml = renderNote({
    id,
    type: input.type,
    title: input.title,
    body_html: cleanBody,
    theme,
    theme_css: themeObj.css,
    theme_profile,
    tags: input.tags ?? [],
    thread_id,
    created,
    updated: created,
    is_final,
  });

  // Atomic write
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, fullHtml, "utf-8");
  renameSync(tmpPath, filePath);

  const relPath = relative(folioRoot(), filePath);

  // DB upsert
  const d = db();
  d.transaction(() => {
    d.run(
      `INSERT INTO notes (id, slug, path, title, type, theme, theme_profile, thread_id, is_final, created, updated, expires_at, word_count, summary, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [id, slug, relPath, input.title, input.type, theme, theme_profile, thread_id, is_final ? 1 : 0, created, created, expires_at, stats.word_count, stats.summary]
    );
    for (const tag of input.tags ?? []) {
      d.run("INSERT OR IGNORE INTO tags (note_id, tag) VALUES (?, ?)", [id, tag]);
    }
    d.run(
      "INSERT INTO notes_fts (id, title, headings, body, tags) VALUES (?, ?, ?, ?, ?)",
      [id, input.title, stats.headings, stats.body, (input.tags ?? []).join(" ")]
    );
  })();

  logEvent(
    "note_created",
    {
      type: input.type,
      theme,
      theme_profile,
      body_size_kb: Math.round(fullHtml.length / 1024),
      plain_text_size: stats.body.length,
      word_count: stats.word_count,
      class_count: stats.class_count,
      inline_style_count: stats.inline_style_count,
      sanitizer_drops: drops,
      thread_id,
    },
    id,
    thread_id
  );

  return {
    id,
    slug,
    path: relPath,
    title: input.title,
    type: input.type,
    theme,
    theme_profile,
    thread_id,
    is_final,
    created,
    updated: created,
    expires_at,
    word_count: stats.word_count,
    summary: stats.summary,
    tags: input.tags ?? [],
  };
}

export function getNoteMeta(id: string): NoteMeta | null {
  const row = db()
    .query<Record<string, any>, [string]>(
      `SELECT * FROM notes WHERE id = ? AND status = 'active'`
    )
    .get(id);
  if (!row) return null;
  return rowToMeta(row);
}

export function getNoteBySlug(slug: string): NoteMeta | null {
  const row = db()
    .query<Record<string, any>, [string]>(
      `SELECT * FROM notes WHERE slug = ? AND status = 'active' ORDER BY created DESC LIMIT 1`
    )
    .get(slug);
  if (!row) return null;
  return rowToMeta(row);
}

export function readNoteHtml(meta: NoteMeta): string {
  return readFileSync(join(folioRoot(), meta.path), "utf-8");
}

export interface ListOptions {
  type?: NoteType;
  thread_id?: string;
  is_final?: boolean;
  limit?: number;
  offset?: number;
}

export function listNotes(opts: ListOptions = {}): NoteMeta[] {
  const where: string[] = ["status = 'active'"];
  const params: any[] = [];
  if (opts.type) {
    where.push("type = ?");
    params.push(opts.type);
  }
  if (opts.thread_id) {
    where.push("thread_id = ?");
    params.push(opts.thread_id);
  }
  if (opts.is_final !== undefined) {
    where.push("is_final = ?");
    params.push(opts.is_final ? 1 : 0);
  }
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const sql = `SELECT * FROM notes WHERE ${where.join(" AND ")} ORDER BY created DESC LIMIT ? OFFSET ?`;
  const rows = db()
    .query<Record<string, any>, any[]>(sql)
    .all(...params, limit, offset);
  return rows.map(rowToMeta);
}

export interface SearchOptions {
  query: string;
  limit?: number;
  type?: NoteType;
}

export function searchNotes(opts: SearchOptions): SearchHit[] {
  const limit = opts.limit ?? 20;
  const ftsQuery = escapeFtsQuery(opts.query);
  if (!ftsQuery) return [];
  // Use FTS BM25 with column weights: title 5, headings 3, body 1, tags 4
  const sql = `
    SELECT
      notes.id, notes.slug, notes.title, notes.type, notes.thread_id, notes.is_final, notes.created,
      bm25(notes_fts, 5.0, 3.0, 1.0, 4.0) AS score,
      snippet(notes_fts, 3, '<mark>', '</mark>', '…', 16) AS snippet,
      'fts' AS matched_columns
    FROM notes_fts
    JOIN notes ON notes.id = notes_fts.id
    WHERE notes_fts MATCH ?
      AND notes.status = 'active'
      ${opts.type ? "AND notes.type = ?" : ""}
    ORDER BY score
    LIMIT ?
  `;
  const params: any[] = [ftsQuery];
  if (opts.type) params.push(opts.type);
  params.push(limit);
  const rows = db()
    .query<any, any[]>(sql)
    .all(...params);
  logEvent("search_query", { query_len: opts.query.length, results_count: rows.length, top_score: rows[0]?.score ?? null });
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    type: r.type as NoteType,
    thread_id: r.thread_id,
    is_final: r.is_final === 1,
    created: r.created,
    score: r.score,
    snippet: r.snippet,
    matched_columns: r.matched_columns,
  }));
}

export function finalize(id: string): boolean {
  const note = getNoteMeta(id);
  if (!note) return false;
  const ageDays = Math.floor((Date.now() - new Date(note.created).getTime()) / 86400000);
  db().run("UPDATE notes SET is_final = 1, expires_at = NULL, updated = ? WHERE id = ?", [
    isoNow(),
    id,
  ]);
  logEvent("note_finalized", { age_days_at_finalize: ageDays }, id, note.thread_id);
  return true;
}

export function listThreads(): { thread_id: string; count: number; latest: string; final_count: number }[] {
  return db()
    .query<{ thread_id: string; count: number; latest: string; final_count: number }, []>(
      `SELECT thread_id, COUNT(*) AS count, MAX(created) AS latest, SUM(is_final) AS final_count
       FROM notes WHERE status = 'active' GROUP BY thread_id ORDER BY latest DESC`
    )
    .all();
}

export function suggestThread(title: string, limit = 5): { thread_id: string; example_title: string; count: number }[] {
  const ftsQuery = escapeFtsQuery(title);
  if (!ftsQuery) return [];
  // Scope match to title column via FTS5 column filter. Order by recency of the
  // most recent matching note in each thread; bm25 isn't reliable under aggregation
  // here so we keep the SQL simple and robust.
  const scoped = ftsQuery.split(" ").map((t) => `title:${t}`).join(" ");
  return db()
    .query<{ thread_id: string; example_title: string; count: number }, [string, number]>(
      `SELECT notes.thread_id,
              (SELECT n2.title FROM notes n2
                 WHERE n2.thread_id = notes.thread_id AND n2.status='active'
                 ORDER BY n2.created DESC LIMIT 1) AS example_title,
              COUNT(*) AS count
       FROM notes_fts JOIN notes ON notes.id = notes_fts.id
       WHERE notes_fts MATCH ? AND notes.status = 'active'
       GROUP BY notes.thread_id
       ORDER BY MAX(notes.created) DESC
       LIMIT ?`
    )
    .all(scoped, limit);
}

export function stats(): Record<string, any> {
  const d = db();
  return {
    total: d.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM notes WHERE status = 'active'").get()?.n ?? 0,
    final: d.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM notes WHERE is_final = 1 AND status = 'active'").get()?.n ?? 0,
    expiring_7d: d
      .query<{ n: number }, []>(
        "SELECT COUNT(*) AS n FROM notes WHERE is_final = 0 AND status = 'active' AND expires_at < datetime('now', '+7 days')"
      )
      .get()?.n ?? 0,
    by_type: d
      .query<{ type: string; n: number }, []>(
        "SELECT type, COUNT(*) AS n FROM notes WHERE status = 'active' GROUP BY type ORDER BY n DESC"
      )
      .all(),
    threads: d.query<{ n: number }, []>("SELECT COUNT(DISTINCT thread_id) AS n FROM notes WHERE status = 'active'").get()?.n ?? 0,
    analytics: {
      avg_class_match: d
        .query<{ avg: number }, []>(
          `SELECT AVG(CAST(json_extract(data,'$.class_count') AS REAL) /
                       NULLIF(CAST(json_extract(data,'$.class_count') AS REAL) +
                              CAST(json_extract(data,'$.inline_style_count') AS REAL), 0)) AS avg
           FROM events WHERE kind = 'note_created'`
        )
        .get()?.avg ?? null,
      total_events: d.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM events").get()?.n ?? 0,
    },
  };
}

function rowToMeta(row: Record<string, any>): NoteMeta {
  const tags = db()
    .query<{ tag: string }, [string]>("SELECT tag FROM tags WHERE note_id = ? ORDER BY tag")
    .all(row.id)
    .map((r) => r.tag);
  return {
    id: row.id,
    slug: row.slug,
    path: row.path,
    title: row.title,
    type: row.type as NoteType,
    theme: row.theme,
    theme_profile: row.theme_profile as RenderProfile,
    thread_id: row.thread_id,
    is_final: row.is_final === 1,
    created: row.created,
    updated: row.updated,
    expires_at: row.expires_at,
    word_count: row.word_count,
    summary: row.summary,
    tags,
  };
}

function escapeFtsQuery(q: string): string {
  // Strip FTS5-special chars; AND tokens with prefix matching.
  // Split on whitespace AND hyphens: unicode61 tokenizes "Fine-Tuning" as ["fine", "tuning"],
  // so our query must mirror that to match.
  const tokens = q
    .trim()
    .split(/[\s\-]+/)
    .map((t) => t.replace(/[^\p{L}\p{N}_]/gu, ""))
    .filter(Boolean);
  if (tokens.length === 0) return "";
  return tokens.map((t) => `${t}*`).join(" ");
}
