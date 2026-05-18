/**
 * v0.27 — three Phase-1 polish features tested via DOM/HTML inspection:
 *   1. Drag-and-drop on panel-mode kanban cards
 *   2. Slide thumbnails sidebar in presentation mode
 *   3. Inline-mode kanban (feed-render INLINE_FEED_BOOTSTRAP_JS)
 *
 * White-box checks: each test inspects rendered source strings (CSS / JS
 * substrings, attribute presence). Browser-runtime behavior (actual drag
 * events, fullscreen API) is covered by manual smoke after release.
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
  tmpDir = mkdtempSync(join(tmpdir(), "folio-v027-"));
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

// ─── 1. Drag-and-drop on panel kanban ──────────────────────────────────

test("panel kanban cards carry draggable='true' + dataset for DnD handlers", async () => {
  const { panelIframeSrcdoc } = await import("../src/viewer/live-panel");
  const html = panelIframeSrcdoc({ theme_css: "", entries_css: "", noteId: "n" });
  // Card template in PANEL_RENDER_JS sets draggable=true on every .kard
  expect(html).toContain('draggable="true"');
  // Lane template carries data-lane-state for drop target detection
  expect(html).toContain('data-lane-state="');
});

test("panel PANEL_RENDER_JS binds dragstart / dragover / drop / dragend", async () => {
  const { panelIframeSrcdoc } = await import("../src/viewer/live-panel");
  const html = panelIframeSrcdoc({ theme_css: "", entries_css: "", noteId: "n" });
  expect(html).toContain("dragstart");
  expect(html).toContain("dragover");
  expect(html).toContain("dragleave");
  expect(html).toContain('addEventListener("drop"');
  expect(html).toContain("is-dragging");
  expect(html).toContain("is-drop-target");
});

test("panel kanban CSS styles drag affordances (.is-dragging + .is-drop-target)", async () => {
  const { panelIframeSrcdoc } = await import("../src/viewer/live-panel");
  const html = panelIframeSrcdoc({ theme_css: "", entries_css: "", noteId: "n" });
  expect(html).toMatch(/\.kard\.is-dragging \{ opacity: 0\.4/);
  expect(html).toMatch(/\.lane\.is-drop-target/);
  expect(html).toMatch(/cursor: grab/);
});

test("panel DnD drop on a different lane postMessages move; same-lane drop is no-op", async () => {
  // White-box assertion: the drop handler computes srcLaneEl and bails
  // when it matches the target — search for the early-return guard.
  const { panelIframeSrcdoc } = await import("../src/viewer/live-panel");
  const html = panelIframeSrcdoc({ theme_css: "", entries_css: "", noteId: "n" });
  expect(html).toMatch(/srcLaneEl.*getAttribute\("data-lane-state"\) === newState/);
  expect(html).toMatch(/postMessage\(\{ ns: "folio-feed", type: "move"/);
});

// ─── 2. Slide thumbnails sidebar ───────────────────────────────────────

test("PRESENTATION_CSS defines .thumbs-rail + .thumb + .thumb.is-current", async () => {
  const { PRESENTATION_CSS } = await import("../src/viewer/presentation-render");
  expect(PRESENTATION_CSS).toContain(".thumbs-rail");
  expect(PRESENTATION_CSS).toContain(".thumb {");
  expect(PRESENTATION_CSS).toContain(".thumb.is-current");
  expect(PRESENTATION_CSS).toContain("body.has-thumbs");
  expect(PRESENTATION_CSS).toContain("body.has-thumbs.is-fullscreen .thumbs-rail { display: none; }");
});

test("PRESENTATION_JS builds the rail, wires T-toggle, and tracks current via .is-current", async () => {
  const { PRESENTATION_JS } = await import("../src/viewer/presentation-render");
  expect(PRESENTATION_JS).toContain('"thumbs-rail"');
  expect(PRESENTATION_JS).toContain("toggleThumbs");
  expect(PRESENTATION_JS).toContain("THUMBS_KEY");
  expect(PRESENTATION_JS).toContain("data-thumb-n");
  expect(PRESENTATION_JS).toContain('e.key === "t" || e.key === "T"');
  // Sync current thumb on every nav
  expect(PRESENTATION_JS).toContain("updateThumbs");
});

test("PRESENTATION_JS syncs body.is-fullscreen on fullscreenchange so the rail auto-hides", async () => {
  const { PRESENTATION_JS } = await import("../src/viewer/presentation-render");
  expect(PRESENTATION_JS).toContain("fullscreenchange");
  expect(PRESENTATION_JS).toContain("is-fullscreen");
});

test("end-to-end: GET /raw/ of a presentation note injects thumbnail rail markup builder", async () => {
  await setup();
  const { createNote } = await import("../src/core/storage");
  const note = await createNote({
    type: "presentation",
    title: "deck",
    body_html: `<section class="slide"><h1>Cover</h1></section><section class="slide"><h1>Topic</h1></section>`,
    thread_id: "deck", theme: "plain", tags: [],
  });
  await startViewer();
  const r = await fetch(`${viewerUrl}/raw/${note.id}`);
  const html = await r.text();
  // Server-side CSS includes rail; JS builds thumbs at runtime so just the
  // rail-builder string is in the script.
  expect(html).toContain(".thumbs-rail");
  expect(html).toContain('"thumbs-rail"');
  expect(html).toContain("toggleThumbs");
});

// ─── 3. Inline-mode kanban ─────────────────────────────────────────────

test("INLINE_FEED_BOOTSTRAP_JS includes the kanban compile + render + DnD code", async () => {
  const { INLINE_FEED_BOOTSTRAP_JS } = await import("../src/core/feed-render");
  // Compile mirror present
  expect(INLINE_FEED_BOOTSTRAP_JS).toContain("compile()");
  expect(INLINE_FEED_BOOTSTRAP_JS).toContain("followupsByTarget");
  // Toggle UI mounting
  expect(INLINE_FEED_BOOTSTRAP_JS).toContain("folio-view-toggle");
  expect(INLINE_FEED_BOOTSTRAP_JS).toContain("folio-kanban-inline");
  // Lanes
  expect(INLINE_FEED_BOOTSTRAP_JS).toContain('state: "open"');
  expect(INLINE_FEED_BOOTSTRAP_JS).toContain('state: "in_progress"');
  expect(INLINE_FEED_BOOTSTRAP_JS).toContain('state: "done"');
  expect(INLINE_FEED_BOOTSTRAP_JS).toContain('state: "cancelled"');
  // Move + DnD postMessage
  expect(INLINE_FEED_BOOTSTRAP_JS).toContain('"folio-feed"');
  expect(INLINE_FEED_BOOTSTRAP_JS).toContain('"move"');
  expect(INLINE_FEED_BOOTSTRAP_JS).toContain("dragstart");
  expect(INLINE_FEED_BOOTSTRAP_JS).toContain("drop");
});

test("INLINE_FEED_BOOTSTRAP_JS uses __folioInlineNoteId for the per-note view-mode key", async () => {
  const { INLINE_FEED_BOOTSTRAP_JS } = await import("../src/core/feed-render");
  expect(INLINE_FEED_BOOTSTRAP_JS).toContain("__folioInlineNoteId");
  expect(INLINE_FEED_BOOTSTRAP_JS).toContain("folio-inline-view:");
});

test("Inline-live /raw/:id bakes window.__folioInlineNoteId script", async () => {
  await setup();
  const { createNote } = await import("../src/core/storage");
  const note = await createNote({
    type: "journal", title: "Daily",
    body_html: `<p>Today</p><section data-folio-live-feed></section>`,
    thread_id: "daily", theme: "linen", tags: [],
    live: true, inline: true,
  });
  await startViewer();
  const r = await fetch(`${viewerUrl}/raw/${note.id}`);
  const html = await r.text();
  expect(html).toContain(`window.__folioInlineNoteId = "${note.id}"`);
  // Bootstrap is appended after the noteId script
  expect(html).toContain("folio-view-toggle");
});

test("Inline-mode chrome script forwards 'move' messages from body iframe to /api/notes/:id/entries", async () => {
  await setup();
  const { createNote } = await import("../src/core/storage");
  const note = await createNote({
    type: "journal", title: "Daily",
    body_html: `<p>Today</p><section data-folio-live-feed></section>`,
    thread_id: "daily", theme: "linen", tags: [],
    live: true, inline: true,
  });
  await startViewer();
  const r = await fetch(`${viewerUrl}/n/${note.id}`);
  const html = await r.text();
  // The inline chrome script (separate from panel mode chrome) carries the
  // POST /api/notes/:id/entries fetch when type === 'move' arrives from the
  // iframe — see render.ts inline branch.
  expect(html).toContain('"folio-feed"');
  expect(html).toContain('"move"');
  expect(html).toContain("/api/notes/");
  expect(html).toContain('"state:" + d.state');
});
