/**
 * v0.25 — Kanban view for live notes with state:* tagged entries.
 *
 * Coverage:
 *   - panelIframeSrcdoc embeds noteId, toggle UI, kanban container
 *   - PANEL_RENDER_JS persists toggle in localStorage per note
 *   - Kanban shows 4 lanes by state (open / in_progress / done / cancelled)
 *   - Move buttons map to postMessage with new state
 *   - POST /api/notes/:id/entries accepts tag-only follow-ups with refs
 *   - POST validates: not-found, not-live, finalized, unknown refs
 *   - LIVE_CHROME_JS forwards "move" messages to the entries endpoint
 */

import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDb } from "../src/core/db";

let tmpDir: string;
let viewer: { stop: () => void; port: number; hostname: string } | null = null;
let viewerUrl = "";

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "folio-kanban-"));
  process.env.FOLIO_HOME = tmpDir;
});

afterEach(() => {
  try { viewer?.stop(); } catch {}
  viewer = null;
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.FOLIO_HOME;
});

async function setup() {
  const { init } = await import("../src/cli/commands/init");
  await init();
}

async function startViewer() {
  const cfgPath = join(tmpDir, "folio.config.json");
  const parsed = JSON.parse(readFileSync(cfgPath, "utf-8"));
  parsed.viewer_port = 0;
  writeFileSync(cfgPath, JSON.stringify(parsed));
  const { startServer } = await import("../src/viewer/server");
  viewer = (await startServer()) as any;
  viewerUrl = `http://${viewer!.hostname}:${viewer!.port}`;
}

// ─── panel srcdoc shape ────────────────────────────────────────────────

test("panelIframeSrcdoc embeds noteId for localStorage + move postMessage", async () => {
  const { panelIframeSrcdoc } = await import("../src/viewer/live-panel");
  const html = panelIframeSrcdoc({ theme_css: "/* css */", entries_css: "/* ec */", noteId: "01ABC" });
  expect(html).toContain('window.__folioPanelNoteId = "01ABC"');
});

test("panelIframeSrcdoc renders view-toggle UI (Feed | Kanban) initially hidden", async () => {
  const { panelIframeSrcdoc } = await import("../src/viewer/live-panel");
  const html = panelIframeSrcdoc({ theme_css: "", entries_css: "", noteId: "n" });
  expect(html).toContain('data-view-toggle');
  expect(html).toMatch(/data-view="feed"/);
  expect(html).toMatch(/data-view="kanban"/);
  expect(html).toContain("kanban");
  // Toggle is hidden in the srcdoc; PANEL_RENDER_JS reveals it when entries
  // with state:* are detected.
  expect(html).toMatch(/data-view-toggle hidden/);
});

test("panelIframeSrcdoc renders kanban container next to feed view", async () => {
  const { panelIframeSrcdoc } = await import("../src/viewer/live-panel");
  const html = panelIframeSrcdoc({ theme_css: "", entries_css: "", noteId: "n" });
  expect(html).toContain('data-feed-view');
  expect(html).toContain('data-kanban');
  expect(html).toContain('class="kanban"');
});

test("PANEL_RENDER_JS persists view choice in localStorage with per-note key", async () => {
  const { panelIframeSrcdoc } = await import("../src/viewer/live-panel");
  const html = panelIframeSrcdoc({ theme_css: "", entries_css: "", noteId: "abc" });
  expect(html).toContain('folio-panel-view:');
  expect(html).toContain('localStorage.setItem(storageKey');
});

test("PANEL_RENDER_JS defines four lanes (open/in_progress/done/cancelled)", async () => {
  const { panelIframeSrcdoc } = await import("../src/viewer/live-panel");
  const html = panelIframeSrcdoc({ theme_css: "", entries_css: "", noteId: "n" });
  expect(html).toContain('state: "open"');
  expect(html).toContain('state: "in_progress"');
  expect(html).toContain('state: "done"');
  expect(html).toContain('state: "cancelled"');
});

test("PANEL_RENDER_JS wires move buttons → postMessage to chrome", async () => {
  const { panelIframeSrcdoc } = await import("../src/viewer/live-panel");
  const html = panelIframeSrcdoc({ theme_css: "", entries_css: "", noteId: "n" });
  expect(html).toContain('data-move-entry');
  expect(html).toContain('data-move-state');
  expect(html).toContain('"folio-feed"');
  expect(html).toContain('"move"');
});

test("LIVE_CHROME_JS forwards 'move' messages to POST /api/notes/:id/entries with state:* + refs", async () => {
  const { LIVE_CHROME_JS } = await import("../src/viewer/live-panel");
  expect(LIVE_CHROME_JS).toContain('"/api/notes/" + encodeURIComponent(noteId) + "/entries"');
  expect(LIVE_CHROME_JS).toContain('"state:" + d.state');
  expect(LIVE_CHROME_JS).toContain("refs: [d.entry_id]");
});

// ─── append-entry endpoint ────────────────────────────────────────────

test("POST /api/notes/:id/entries appends an entry to a live note", async () => {
  await setup();
  const { createNote } = await import("../src/core/storage");
  const note = await createNote({
    type: "snippet", title: "Todo", body_html: "<p>list</p>",
    thread_id: "t", theme: "linen", tags: ["slot:todo"],
    live: true,
  });
  await startViewer();
  const r = await fetch(`${viewerUrl}/api/notes/${note.id}/entries`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content_html: "<p>buy milk</p>", tags: ["state:open"] }),
  });
  expect(r.status).toBe(200);
  const data = (await r.json()) as any;
  expect(data.ok).toBe(true);
  expect(data.entry_id).toBeTruthy();
});

test("POST /api/notes/:id/entries appends a tag-only follow-up (kanban move)", async () => {
  await setup();
  const { createNote } = await import("../src/core/storage");
  const note = await createNote({
    type: "snippet", title: "Todo", body_html: "<p>list</p>",
    thread_id: "t", theme: "linen", tags: [], live: true,
  });
  await startViewer();
  // First — append a real entry
  const r1 = await fetch(`${viewerUrl}/api/notes/${note.id}/entries`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ content_html: "<p>do thing</p>", tags: ["state:open"] }),
  });
  const e1 = (await r1.json()) as any;
  // Then — empty-content follow-up that flips its state to done
  const r2 = await fetch(`${viewerUrl}/api/notes/${note.id}/entries`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ content_html: "", tags: ["state:done"], refs: [e1.entry_id] }),
  });
  expect(r2.status).toBe(200);
  const data = (await r2.json()) as any;
  expect(data.ok).toBe(true);
});

test("POST /api/notes/:id/entries with unknown refs returns 400", async () => {
  await setup();
  const { createNote } = await import("../src/core/storage");
  const note = await createNote({
    type: "snippet", title: "x", body_html: "<p>x</p>",
    thread_id: "t", theme: "linen", tags: [], live: true,
  });
  await startViewer();
  const r = await fetch(`${viewerUrl}/api/notes/${note.id}/entries`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ content_html: "", tags: ["state:done"], refs: ["nonsense-id"] }),
  });
  expect(r.status).toBe(400);
  const data = (await r.json()) as any;
  expect(data.error).toMatch(/unknown refs/);
});

test("POST /api/notes/:id/entries on a non-live note returns 400", async () => {
  await setup();
  const { createNote } = await import("../src/core/storage");
  const note = await createNote({
    type: "research", title: "Static", body_html: "<p>x</p>",
    thread_id: "t", theme: "linen", tags: [],
  });
  await startViewer();
  const r = await fetch(`${viewerUrl}/api/notes/${note.id}/entries`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ content_html: "<p>x</p>" }),
  });
  expect(r.status).toBe(400);
  const data = (await r.json()) as any;
  expect(data.error).toContain("not a live note");
});

test("POST /api/notes/:id/entries on a finalized note returns 400", async () => {
  await setup();
  const { createNote, finalize } = await import("../src/core/storage");
  const note = await createNote({
    type: "snippet", title: "x", body_html: "<p>x</p>",
    thread_id: "t", theme: "linen", tags: [], live: true,
  });
  finalize(note.id);
  await startViewer();
  const r = await fetch(`${viewerUrl}/api/notes/${note.id}/entries`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ content_html: "<p>x</p>" }),
  });
  expect(r.status).toBe(400);
  const data = (await r.json()) as any;
  expect(data.error).toContain("final");
});

test("POST /api/notes/:id/entries on a missing id returns 404", async () => {
  await setup();
  await startViewer();
  const r = await fetch(`${viewerUrl}/api/notes/01NONEXISTENT0000000000000/entries`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ content_html: "<p>x</p>" }),
  });
  expect(r.status).toBe(404);
});

test("POST /api/notes/:id/entries logs a live_entry_appended event with via:viewer", async () => {
  await setup();
  const { createNote } = await import("../src/core/storage");
  const { db } = await import("../src/core/db");
  const note = await createNote({
    type: "snippet", title: "x", body_html: "<p>x</p>",
    thread_id: "t", theme: "linen", tags: [], live: true,
  });
  await startViewer();
  await fetch(`${viewerUrl}/api/notes/${note.id}/entries`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ content_html: "<p>via viewer</p>", tags: ["state:open"] }),
  });
  const events = db()
    .query<{ data: string }, []>("SELECT data FROM events WHERE kind = 'live_entry_appended' ORDER BY id DESC LIMIT 1")
    .get();
  expect(events).toBeTruthy();
  const data = JSON.parse(events!.data);
  expect(data.via).toBe("viewer");
});

// ─── full Note page integration (panel iframe srcdoc embedded) ────────

test("GET /n/:id on a live note embeds the panel iframe with noteId baked in", async () => {
  await setup();
  const { createNote } = await import("../src/core/storage");
  const note = await createNote({
    type: "snippet", title: "Live with state", body_html: "<p>scaffold</p>",
    thread_id: "live", theme: "linen", tags: [], live: true,
  });
  await startViewer();
  const r = await fetch(`${viewerUrl}/n/${note.id}`);
  const html = await r.text();
  expect(html).toContain("live-panel-iframe");
  // srcdoc carries the noteId literal so the panel knows its own id
  expect(html).toContain(`window.__folioPanelNoteId = &quot;${note.id}&quot;`);
});
