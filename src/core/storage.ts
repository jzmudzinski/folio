import { ulid } from "ulid";
import { existsSync, mkdirSync, renameSync, writeFileSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { db, logEvent } from "./db";
import { folioRoot, threadsDir, notesDir, loadConfig, getOrCreateDeviceId } from "./config";
import { slugify, plNormalize, plStem } from "./slug";
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

  // For inline-rendered live notes, ensure body_html has a place to
  // splice entries. If the agent didn't include the placeholder, append
  // one at the end before sanitize. The data-folio-live-feed attribute
  // is preserved by the sanitizer (data-* attrs are allowed globally).
  let bodyHtmlIn = input.body_html;
  if ((input.live ?? false) && (input.inline ?? false) && !/data-folio-live-feed/.test(bodyHtmlIn)) {
    bodyHtmlIn += `\n<section data-folio-live-feed></section>`;
  }

  // Sanitize body
  const { html: cleanBody, drops } = sanitize(bodyHtmlIn);

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
  const live = input.live ?? false;
  // inline_render is meaningful only when live=true. Silently ignored on
  // non-live notes (rather than erroring) so a flag-passing agent doesn't
  // need a branch.
  const inline_render = live && (input.inline ?? false);
  // Live notes auto-expire based on inactivity, not absolute age. Set
  // expires_at to the lifespan default at creation; list_expiring uses
  // last_entry_at (NULL initially) for the actual idle check.
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

  // Device identity (W2): stamp origin on every note; owner only for live.
  const device = getOrCreateDeviceId();
  const origin_device_id = device.id;
  const owner_device_id = live ? device.id : null;

  // DB upsert
  const d = db();
  d.transaction(() => {
    d.run(
      `INSERT INTO notes (id, slug, path, title, type, theme, theme_profile, thread_id, is_final, created, updated, expires_at, word_count, summary, status, live, last_entry_at, origin_device_id, owner_device_id, inline_render)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, NULL, ?, ?, ?)`,
      [id, slug, relPath, input.title, input.type, theme, theme_profile, thread_id, is_final ? 1 : 0, created, created, expires_at, stats.word_count, stats.summary, live ? 1 : 0, origin_device_id, owner_device_id, inline_render ? 1 : 0]
    );
    for (const tag of input.tags ?? []) {
      d.run("INSERT OR IGNORE INTO tags (note_id, tag) VALUES (?, ?)", [id, tag]);
    }
    d.run(
      "INSERT INTO notes_fts (id, title, headings, body, tags) VALUES (?, ?, ?, ?, ?)",
      [
        id,
        plNormalize(input.title),
        plNormalize(stats.headings),
        plNormalize(stats.body),
        plNormalize((input.tags ?? []).join(" ")),
      ]
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
      live,
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
    live,
    last_entry_at: null,
    created,
    updated: created,
    expires_at,
    word_count: stats.word_count,
    summary: stats.summary,
    tags: input.tags ?? [],
    origin_device_id,
    owner_device_id,
    inline_render,
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
  tag?: string;
  is_final?: boolean;
  limit?: number;
  offset?: number;
}

export function listNotes(opts: ListOptions = {}): NoteMeta[] {
  const where: string[] = ["notes.status = 'active'"];
  const params: any[] = [];
  // Tag filter via JOIN to the indexed tags table (tags_by_tag covers it)
  const joinClause = opts.tag ? "JOIN tags ON tags.note_id = notes.id" : "";
  if (opts.tag) {
    where.push("tags.tag = ?");
    params.push(opts.tag);
  }
  if (opts.type) {
    where.push("notes.type = ?");
    params.push(opts.type);
  }
  if (opts.thread_id) {
    where.push("notes.thread_id = ?");
    params.push(opts.thread_id);
  }
  if (opts.is_final !== undefined) {
    where.push("notes.is_final = ?");
    params.push(opts.is_final ? 1 : 0);
  }
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const sql = `SELECT notes.* FROM notes ${joinClause} WHERE ${where.join(" AND ")} ORDER BY notes.created DESC LIMIT ? OFFSET ?`;
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

/** Update notes.last_entry_at after a successful append. */
export function updateLastEntryAt(id: string, ts: string): void {
  db().run("UPDATE notes SET last_entry_at = ?, updated = ? WHERE id = ?", [ts, isoNow(), id]);
}

/**
 * Soft-delete a note: move file to ~/Folio/.trash/<id>/note.html, mark
 * status='trashed', remove from FTS so search doesn't return it.
 *
 * Recoverable for `trash_grace_days` (default 7) via the existing cleanup
 * flow — move file back + reindex. After that, `folio cleanup` hard-deletes
 * the DB row + files.
 *
 * ADR-014 (append-only) stance: this is a HUMAN-initiated boundary
 * crossing, same as finalize(). Agents have no MCP tool to delete —
 * iterations create new sibling notes, period. The CLI / viewer expose
 * this for the human operator.
 *
 * Sync: the sync daemon picks up status='trashed' notes via a separate
 * cursor and propagates DELETEs to the cloud relay; cloud cascades to
 * tags + live_entries. Other devices that have this note locally will
 * still see it until they too run `folio delete` (no auto-propagation
 * via pull — same scope cut as W2 finalize: cleanup is per-device).
 */
export function deleteNote(id: string): { ok: boolean; reason?: "not-found" } {
  const note = getNoteMeta(id);
  if (!note) return { ok: false, reason: "not-found" };

  const root = folioRoot();
  const absPath = join(root, note.path);
  const trashDir = join(root, ".trash", id);

  // Idempotent prep: trash dir.
  if (!existsSync(trashDir)) mkdirSync(trashDir, { recursive: true });

  // Move .html if present (best effort — concurrent deletes can race).
  if (existsSync(absPath)) {
    try { renameSync(absPath, join(trashDir, "note.html")); } catch {}
  }

  // Live notes have a sidecar .entries.jsonl; archive it too.
  const jsonl = absPath.replace(/\.html$/, ".entries.jsonl");
  if (existsSync(jsonl)) {
    try { renameSync(jsonl, join(trashDir, "entries.jsonl")); } catch {}
  }

  const d = db();
  d.transaction(() => {
    d.run("UPDATE notes SET status = 'trashed', updated = ? WHERE id = ?", [isoNow(), id]);
    d.run("DELETE FROM notes_fts WHERE id = ?", [id]);
  })();

  logEvent("note_deleted", { reason: "manual", thread_id: note.thread_id }, id, note.thread_id);
  return { ok: true };
}

export function finalize(id: string): boolean {
  const note = getNoteMeta(id);
  if (!note) return false;
  // Idempotent: re-finalize is a no-op (also covers race conditions where
  // two callers attempt finalize simultaneously).
  if (note.is_final) return true;

  const ageDays = Math.floor((Date.now() - new Date(note.created).getTime()) / 86400000);

  if (note.live) {
    finalizeLive(note);
  }

  db().run(
    "UPDATE notes SET is_final = 1, live = 0, expires_at = NULL, updated = ? WHERE id = ?",
    [isoNow(), id],
  );
  logEvent(
    "note_finalized",
    { age_days_at_finalize: ageDays, was_live: note.live },
    id,
    note.thread_id,
  );
  return true;
}

/**
 * Live-note finalize: read the .entries.jsonl sidecar, compile to
 * <article class="entry [state-*]">…</article> blocks, replace the note's
 * <article data-folio-content>…</article> body inline, atomic-rename
 * temp file over the .html. Move the jsonl to ~/Folio/.trash/ so it's
 * archived but no longer streamed.
 *
 * Per ADR-014: this is the explicit boundary where in-place mutation
 * of a note's .html is allowed. finalize = "freeze the live feed into
 * the static body and stop being live."
 *
 * Per ADR-017: emits a `note_finalized_live` event with entries_compiled
 * count + summed sanitizer_drops from the original append events
 * (already counted; we don't re-emit per entry).
 *
 * No content re-sanitization: each entry.content_html was sanitized on
 * append_entry. The wrapper HTML we generate here is server-trusted —
 * adding a second sanitize pass would risk mangling already-valid
 * content for no security gain.
 */
function finalizeLive(note: NoteMeta): void {
  const { entriesPath, readEntries, compileRendered } = require("./live") as typeof import("./live");
  const absPath = join(folioRoot(), note.path);
  const jsonl = entriesPath(absPath);
  const rawEntries = readEntries(jsonl);
  const compiled = compileRendered(rawEntries);
  const totalEntries = rawEntries.length;
  const renderedCount = compiled.length;

  // Build the compiled body. Each entry becomes:
  //   <article class="entry [state-*] [pinned]" data-entry-id="…">
  //     <header class="meta">…tags + time…</header>
  //     <div class="content">{content_html — already sanitized}</div>
  //   </article>
  // entries-css.ts ships the baseline; themes can override.
  // Pinned entries float to the top in a <section class="entries-pinned">.
  const pinned = compiled.filter((c) => c.pinned);
  const rest = compiled.filter((c) => !c.pinned);

  const renderTag = (t: string): string => {
    const safe = String(t).replace(/[<>&"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[ch] ?? ch);
    return `<span class="pill info">${safe}</span>`;
  };

  const renderEntry = (c: typeof compiled[number]): string => {
    const cls = ["entry"];
    if (c.pinned) cls.push("pinned");
    if (c.state) cls.push(`state-${c.state}`);
    const tagsHtml = c.compiled_tags.map(renderTag).join(" ");
    const timeHtml = `<time datetime="${c.ts}">${c.ts}</time>`;
    return [
      `<article class="${cls.join(" ")}" data-entry-id="${c.id}">`,
      `  <header class="meta">${timeHtml} ${tagsHtml}</header>`,
      `  <div class="content">${c.content_html}</div>`,
      `</article>`,
    ].join("\n");
  };

  const pinnedHtml = pinned.length > 0
    ? `<section class="entries-pinned"><h3>Pinned</h3>\n${pinned.map(renderEntry).join("\n")}\n</section>`
    : "";
  const restHtml = rest.length > 0
    ? `<section class="entries-feed">\n${rest.map(renderEntry).join("\n")}\n</section>`
    : "";
  const compiledBody = [pinnedHtml, restHtml].filter(Boolean).join("\n");

  // Replace <article data-folio-content>…</article> inline. The _base.html.eta
  // emits exactly one such block per note (the user's body wrapped).
  const existing = readFileSync(absPath, "utf-8");
  const replaced = existing.replace(
    /(<article[^>]*data-folio-content[^>]*>)[\s\S]*?(<\/article>)/,
    `$1\n${compiledBody}\n$2`,
  );
  const tmpPath = `${absPath}.tmp`;
  writeFileSync(tmpPath, replaced, "utf-8");
  renameSync(tmpPath, absPath);

  // Move the jsonl to .trash/. Use a name that includes the note id so
  // multiple finalized notes don't collide.
  if (existsSync(jsonl)) {
    const trashDir = join(folioRoot(), ".trash");
    ensureDir(trashDir);
    const trashPath = join(trashDir, `${note.id}.entries.jsonl`);
    renameSync(jsonl, trashPath);
  }

  logEvent(
    "note_finalized_live",
    {
      entries_total: totalEntries,
      entries_rendered: renderedCount,
      pinned_count: pinned.length,
    },
    note.id,
    note.thread_id,
  );
}

export interface ReindexResult {
  ok: number;
  failed: Array<{ id: string; error: string }>;
}

/**
 * Rebuild FTS index for all active notes from their HTML files on disk.
 * Use after tokenizer or normalization changes.
 */
export async function reindexAll(): Promise<ReindexResult> {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const d = db();
  let ok = 0;
  const failed: ReindexResult["failed"] = [];

  const notes = d
    .query<{ id: string; path: string; title: string }, []>(
      "SELECT id, path, title FROM notes WHERE status = 'active'"
    )
    .all();

  for (const n of notes) {
    try {
      const html = readFileSync(join(folioRoot(), n.path), "utf-8");
      const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/);
      const bodySrc = articleMatch ? articleMatch[1] : html;
      const stats = extractText(bodySrc);
      const tags = d
        .query<{ tag: string }, [string]>("SELECT tag FROM tags WHERE note_id = ? ORDER BY tag")
        .all(n.id)
        .map((r) => r.tag);
      d.transaction(() => {
        d.run("DELETE FROM notes_fts WHERE id = ?", [n.id]);
        d.run(
          "INSERT INTO notes_fts (id, title, headings, body, tags) VALUES (?, ?, ?, ?, ?)",
          [
            n.id,
            plNormalize(n.title),
            plNormalize(stats.headings),
            plNormalize(stats.body),
            plNormalize(tags.join(" ")),
          ]
        );
        d.run("UPDATE notes SET word_count = ?, summary = ? WHERE id = ?", [
          stats.word_count,
          stats.summary,
          n.id,
        ]);
      })();
      ok++;
    } catch (e: any) {
      failed.push({ id: n.id, error: e?.message ?? String(e) });
    }
  }

  return { ok, failed };
}

export interface CleanupResult {
  trashed: Array<{ id: string; title: string; path: string; age_days: number }>;
  hard_deleted: Array<{ id: string; path: string }>;
  dry_run: boolean;
}

/**
 * Phase 1: non-final notes past `expires_at` → move to ~/Folio/.trash/<id>/.
 * Phase 2: trash entries older than `trash_grace_days` → unlink files (and remove DB row).
 *
 * Returns counts and what was moved/deleted. `dry_run` skips filesystem changes
 * but still reports what would happen.
 */
export async function cleanup(opts: { dry_run?: boolean; trash_grace_days?: number } = {}): Promise<CleanupResult> {
  const { existsSync, mkdirSync, renameSync, unlinkSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const root = folioRoot();
  const trashRoot = join(root, ".trash");
  const dry = opts.dry_run ?? false;
  const trash_grace_days = opts.trash_grace_days ?? 7;

  const d = db();
  const trashed: CleanupResult["trashed"] = [];
  const hard_deleted: CleanupResult["hard_deleted"] = [];

  // Phase 1
  const expired = d
    .query<{ id: string; title: string; path: string; created: string }, []>(
      `SELECT id, title, path, created FROM notes
       WHERE status = 'active' AND is_final = 0 AND expires_at IS NOT NULL
         AND expires_at < datetime('now')`
    )
    .all();

  for (const row of expired) {
    const ageDays = Math.floor((Date.now() - new Date(row.created).getTime()) / 86400000);
    trashed.push({ id: row.id, title: row.title, path: row.path, age_days: ageDays });
    if (dry) continue;
    const fullPath = join(root, row.path);
    if (existsSync(fullPath)) {
      const trashDir = join(trashRoot, row.id);
      mkdirSync(trashDir, { recursive: true });
      try {
        renameSync(fullPath, join(trashDir, "note.html"));
      } catch {
        // best-effort
      }
    }
    d.run("UPDATE notes SET status = 'trashed', updated = ? WHERE id = ?", [new Date().toISOString(), row.id]);
    logEvent("note_deleted", { reason: "auto", age_days: ageDays }, row.id);
  }

  // Phase 2: hard delete trash older than grace
  // Find DB rows in 'trashed' status updated > N days ago
  const stale = d
    .query<{ id: string; path: string }, [number]>(
      `SELECT id, path FROM notes
       WHERE status = 'trashed' AND updated < datetime('now', '-' || ? || ' days')`
    )
    .all(trash_grace_days);
  for (const row of stale) {
    hard_deleted.push({ id: row.id, path: row.path });
    if (dry) continue;
    const trashFile = join(trashRoot, row.id);
    try { rmSync(trashFile, { recursive: true, force: true }); } catch {}
    d.run("DELETE FROM notes WHERE id = ?", [row.id]); // FK cascade removes tags
    d.run("DELETE FROM notes_fts WHERE id = ?", [row.id]);
  }

  return { trashed, hard_deleted, dry_run: dry };
}

export function listThreads(query?: string, limit = 200): { thread_id: string; count: number; latest: string; final_count: number }[] {
  if (!query?.trim()) {
    return db()
      .query<{ thread_id: string; count: number; latest: string; final_count: number }, [number]>(
        `SELECT thread_id, COUNT(*) AS count, MAX(created) AS latest, SUM(is_final) AS final_count
         FROM notes WHERE status = 'active' GROUP BY thread_id ORDER BY latest DESC LIMIT ?`
      )
      .all(limit);
  }
  // Match against either thread_id (slug substring) OR any note title in the thread (FTS).
  const norm = plNormalize(query).toLowerCase().trim();
  const ftsQuery = escapeFtsQuery(query);
  const slugLike = `%${norm.replace(/\s+/g, "%")}%`;
  if (!ftsQuery) {
    return db()
      .query<{ thread_id: string; count: number; latest: string; final_count: number }, [string, number]>(
        `SELECT thread_id, COUNT(*) AS count, MAX(created) AS latest, SUM(is_final) AS final_count
         FROM notes WHERE status = 'active' AND lower(thread_id) LIKE ?
         GROUP BY thread_id ORDER BY latest DESC LIMIT ?`
      )
      .all(slugLike, limit);
  }
  // Threads where slug matches OR any note title matches FTS.
  const scoped = ftsQuery.split(" ").map((t) => `title:${t}`).join(" ");
  return db()
    .query<{ thread_id: string; count: number; latest: string; final_count: number }, [string, string, number]>(
      `WITH matched_ids AS (
         SELECT id FROM notes_fts WHERE notes_fts MATCH ?
       )
       SELECT n.thread_id,
              COUNT(*) AS count,
              MAX(n.created) AS latest,
              SUM(n.is_final) AS final_count
       FROM notes n
       WHERE n.status = 'active'
         AND (lower(n.thread_id) LIKE ? OR n.thread_id IN (
             SELECT DISTINCT n2.thread_id FROM notes n2 JOIN matched_ids m ON m.id = n2.id WHERE n2.status = 'active'
         ))
       GROUP BY n.thread_id
       ORDER BY latest DESC
       LIMIT ?`
    )
    .all(scoped, slugLike, limit);
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

export function listPopularTags(limit = 20, minCount = 2): { tag: string; count: number }[] {
  return db()
    .query<{ tag: string; count: number }, [number, number]>(
      `SELECT t.tag, COUNT(*) AS count
         FROM tags t
         JOIN notes n ON n.id = t.note_id
        WHERE n.status = 'active'
        GROUP BY t.tag
       HAVING count >= ?
        ORDER BY count DESC, t.tag ASC
        LIMIT ?`
    )
    .all(minCount, limit);
}

export function listNotesByTag(tag: string, limit = 200): NoteMeta[] {
  const rows = db()
    .query<Record<string, any>, [string, number]>(
      `SELECT n.* FROM notes n
         JOIN tags t ON t.note_id = n.id
        WHERE n.status = 'active' AND t.tag = ?
        ORDER BY n.created DESC
        LIMIT ?`
    )
    .all(tag, limit);
  return rows.map(rowToMeta);
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
    live: row.live === 1,
    last_entry_at: row.last_entry_at ?? null,
    created: row.created,
    updated: row.updated,
    expires_at: row.expires_at,
    word_count: row.word_count,
    summary: row.summary,
    tags,
    origin_device_id: row.origin_device_id ?? null,
    owner_device_id: row.owner_device_id ?? null,
    inline_render: row.inline_render === 1,
  };
}

function escapeFtsQuery(q: string): string {
  // 1. Normalize PL (ł→l, ą→a, etc.) — symmetry with FTS insert
  // 2. Split on whitespace AND hyphens (unicode61 splits "Fine-Tuning" → fine, tuning)
  // 3. Strip non-word chars
  // 4. Stem each token (PL suffix stripper) — only at query, NOT index, so:
  //    - snippet still shows real words
  //    - prefix-match catches more inflections ("wyboru" → "wybor*" matches "wybór")
  const tokens = plNormalize(q)
    .trim()
    .split(/[\s\-]+/)
    .map((t) => t.replace(/[^\p{L}\p{N}_]/gu, "").toLowerCase())
    .filter(Boolean)
    .map(plStem);
  if (tokens.length === 0) return "";
  return tokens.map((t) => `${t}*`).join(" ");
}
