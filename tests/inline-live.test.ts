/**
 * Inline-rendered live notes (v0.17+).
 *
 *  ✓ createNote({live:true, inline:true}) stamps notes.inline_render=1
 *  ✓ inline is ignored when live=false (no schema breakage)
 *  ✓ body_html without placeholder gets <section data-folio-live-feed> appended
 *  ✓ /raw/ splices current entries into the placeholder + appends bootstrap script
 *  ✓ pageNote suppresses the side panel for inline live notes, emits SSE→postMessage wiring
 *  ✓ append_entry + sync: entries appear in /raw/ on the next hit (server-side compile)
 */

import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDb } from "../src/core/db";

let homeDir: string;
let viewer: { stop: () => void; port: number; hostname: string } | null = null;
let viewerUrl = "";

async function bootViewer(): Promise<void> {
  const { init } = await import("../src/cli/commands/init");
  await init();
  const cfgPath = join(homeDir, "folio.config.json");
  const parsed = JSON.parse(readFileSync(cfgPath, "utf-8"));
  parsed.viewer_port = 0;
  writeFileSync(cfgPath, JSON.stringify(parsed));
  const { startServer } = await import("../src/viewer/server");
  viewer = (await startServer()) as any;
  viewerUrl = `http://${viewer!.hostname}:${viewer!.port}`;
}

beforeEach(async () => {
  homeDir = mkdtempSync(join(tmpdir(), "folio-inline-live-"));
  process.env.FOLIO_HOME = homeDir;
});

afterEach(() => {
  try { viewer?.stop(); } catch {}
  viewer = null;
  closeDb();
  rmSync(homeDir, { recursive: true, force: true });
  delete process.env.FOLIO_HOME;
});

test("createNote(live:true, inline:true) stamps inline_render=1 + auto-injects placeholder", async () => {
  const { init } = await import("../src/cli/commands/init");
  await init();
  const { createNote, getNoteMeta, readNoteHtml } = await import("../src/core/storage");
  const note = await createNote({
    type: "journal",
    title: "Inline journal",
    body_html: "<h1>Morning</h1><p>Tracking the day.</p>",
    thread_id: "inline-test",
    live: true,
    inline: true,
  });
  const meta = getNoteMeta(note.id);
  expect(meta?.live).toBe(true);
  expect(meta?.inline_render).toBe(true);
  // Placeholder auto-injected when missing.
  const html = readNoteHtml(meta!);
  expect(html).toContain('data-folio-live-feed');
});

test("createNote(live:true, inline:true) keeps the agent's placeholder when present", async () => {
  const { init } = await import("../src/cli/commands/init");
  await init();
  const { createNote, readNoteHtml, getNoteMeta } = await import("../src/core/storage");
  const note = await createNote({
    type: "journal",
    title: "With my own placeholder",
    body_html: `<h1>Feed</h1><section data-folio-live-feed class="my-feed"></section><footer>tail</footer>`,
    thread_id: "inline-2",
    live: true,
    inline: true,
  });
  const html = readNoteHtml(getNoteMeta(note.id)!);
  // Only one placeholder (didn't append a second one).
  const matches = html.match(/data-folio-live-feed/g) ?? [];
  expect(matches.length).toBe(1);
  expect(html).toContain('class="my-feed"');
});

test("inline:true is ignored when live:false", async () => {
  const { init } = await import("../src/cli/commands/init");
  await init();
  const { createNote, getNoteMeta } = await import("../src/core/storage");
  const note = await createNote({
    type: "snippet",
    title: "Static note with inline flag",
    body_html: "<p>x</p>",
    thread_id: "inline-ignored",
    live: false,
    inline: true, // should be silently ignored
  });
  const meta = getNoteMeta(note.id);
  expect(meta?.live).toBe(false);
  expect(meta?.inline_render).toBe(false);
});

test("/raw/ splices current entries into the placeholder + appends bootstrap script", async () => {
  await bootViewer();
  const { createNote } = await import("../src/core/storage");
  const { appendEntry, entriesPath } = await import("../src/core/live");
  const note = await createNote({
    type: "journal",
    title: "Live inline raw",
    body_html: `<h1>Today</h1><section data-folio-live-feed></section>`,
    thread_id: "inline-raw",
    live: true,
    inline: true,
  });
  const jsonl1 = entriesPath(join(homeDir, note.path));
  appendEntry(jsonl1, { content_html: "<p>first entry</p>", tags: ["state:open"] });
  appendEntry(jsonl1, { content_html: "<p>second entry</p>", tags: [] });

  const html = await fetch(`${viewerUrl}/raw/${note.id}`).then((r) => r.text());
  // Both entries surfaced inside the placeholder.
  expect(html).toContain("first entry");
  expect(html).toContain("second entry");
  // Entries are wrapped as <article class="entry …" data-entry-id>.
  expect(html.match(/data-entry-id=/g)?.length).toBeGreaterThanOrEqual(2);
  // Bootstrap listener for postMessage from parent.
  expect(html).toContain("inline-feed-ready");
  expect(html).toContain("addEventListener(\"message\"");
});

test("non-inline live note: /raw/ does NOT inject entries or bootstrap", async () => {
  await bootViewer();
  const { createNote } = await import("../src/core/storage");
  const { appendEntry, entriesPath } = await import("../src/core/live");
  const note = await createNote({
    type: "journal",
    title: "Panel-mode live note",
    body_html: "<h1>Panel mode</h1>",
    thread_id: "panel-mode",
    live: true,
    // inline omitted → defaults to false → panel mode
  });
  const jsonl2 = entriesPath(join(homeDir, note.path));
  appendEntry(jsonl2, { content_html: "<p>panel entry</p>", tags: [] });

  const html = await fetch(`${viewerUrl}/raw/${note.id}`).then((r) => r.text());
  // Entries do NOT appear in body for panel-mode notes (they live in the side panel iframe).
  expect(html).not.toContain("panel entry");
  expect(html).not.toContain("inline-feed-ready");
});

test("pageNote: inline live note suppresses side panel + emits SSE→postMessage wiring", async () => {
  await bootViewer();
  const { createNote } = await import("../src/core/storage");
  const inline = await createNote({
    type: "journal",
    title: "Inline page",
    body_html: "<h1>Inline</h1>",
    thread_id: "page-inline",
    live: true,
    inline: true,
  });
  const panel = await createNote({
    type: "journal",
    title: "Panel page",
    body_html: "<h1>Panel</h1>",
    thread_id: "page-panel",
    live: true,
    // inline default false
  });

  const inlineHtml = await fetch(`${viewerUrl}/n/${inline.id}`).then((r) => r.text());
  const panelHtml = await fetch(`${viewerUrl}/n/${panel.id}`).then((r) => r.text());

  // Inline: no side-panel iframe element + has the SSE→postMessage forwarder.
  // (The string "live-panel-iframe" appears in the inlined CSS rule
  // .live-panel-iframe regardless of mode — we check for the actual element.)
  expect(inlineHtml).not.toContain('<iframe class="live-panel-iframe"');
  // note-shell class is plain "note-shell", not "note-shell has-live".
  expect(inlineHtml).toMatch(/<div class="note-shell"[^h]/);
  expect(inlineHtml).toContain("new EventSource");
  expect(inlineHtml).toContain("inline-feed-ready");

  // Panel mode: has the side-panel iframe element + has-live grid class on the shell.
  expect(panelHtml).toContain('<iframe class="live-panel-iframe"');
  expect(panelHtml).toContain('class="note-shell has-live"');
});

test("finalize on inline-rendered live note works (still compiles entries into body)", async () => {
  await bootViewer();
  const { createNote, finalize } = await import("../src/core/storage");
  const { appendEntry, entriesPath } = await import("../src/core/live");
  const note = await createNote({
    type: "journal",
    title: "Finalize-me",
    body_html: `<h1>About to finalize</h1><section data-folio-live-feed></section>`,
    thread_id: "fin-inline",
    live: true,
    inline: true,
  });
  const jsonl = entriesPath(join(homeDir, note.path));
  appendEntry(jsonl, { content_html: "<p>only entry</p>", tags: [] });
  const ok = finalize(note.id);
  expect(ok).toBe(true);
  // Body file on disk has the entry compiled in.
  const { getNoteMeta, readNoteHtml } = await import("../src/core/storage");
  const meta = getNoteMeta(note.id);
  expect(meta?.is_final).toBe(true);
  const html = readNoteHtml(meta!);
  expect(html).toContain("only entry");
});
