/**
 * v0.26 — Presentation mode (type: "presentation"). Body_html with
 * <section class="slide"> blocks. Viewer injects slide nav script +
 * CSS at /raw/ render time.
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
  tmpDir = mkdtempSync(join(tmpdir(), "folio-pres-"));
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

// ─── Type allowed ──────────────────────────────────────────────────────

test("createNote accepts type: 'presentation'", async () => {
  await setup();
  const { createNote, getNoteMeta } = await import("../src/core/storage");
  const note = await createNote({
    type: "presentation",
    title: "Q3 review",
    body_html: `<section class="slide"><h1>Hi</h1></section><section class="slide"><h2>Bye</h2></section>`,
    thread_id: "q3", theme: "plain", tags: [],
  });
  const meta = getNoteMeta(note.id);
  expect(meta?.type).toBe("presentation");
});

test("listNotes filter type='presentation' returns only presentation notes", async () => {
  await setup();
  const { createNote, listNotes } = await import("../src/core/storage");
  await createNote({
    type: "presentation", title: "deck", body_html: `<section class="slide"><h1>x</h1></section>`,
    thread_id: "d", theme: "plain", tags: [],
  });
  await createNote({
    type: "research", title: "doc", body_html: "<p>x</p>",
    thread_id: "r", theme: "linen", tags: [],
  });
  const presOnly = listNotes({ type: "presentation" as any });
  expect(presOnly.length).toBe(1);
  expect(presOnly[0]!.title).toBe("deck");
});

// ─── Render injection ──────────────────────────────────────────────────

test("/raw/:id of a presentation note injects PRESENTATION_CSS + PRESENTATION_JS", async () => {
  await setup();
  const { createNote } = await import("../src/core/storage");
  const note = await createNote({
    type: "presentation", title: "deck", theme: "plain",
    body_html: `<section class="slide"><h1>Slide 1</h1></section><section class="slide"><h2>Slide 2</h2></section>`,
    thread_id: "deck", tags: [],
  });
  await startViewer();
  const r = await fetch(`${viewerUrl}/raw/${note.id}`);
  const html = await r.text();
  // CSS — slide visibility rule
  expect(html).toContain(".slide.is-current { display: flex; }");
  expect(html).toContain("body.is-speaker");
  // JS — keyboard nav handler + slide-nav overlay
  expect(html).toContain('ArrowRight');
  expect(html).toContain('toggleFullscreen');
  expect(html).toContain('nav.className = "slide-nav"');
  // Slides remain in the body
  expect(html).toContain('<section class="slide"><h1>Slide 1</h1></section>');
});

test("/raw/:id of a non-presentation note does NOT inject the slide script", async () => {
  await setup();
  const { createNote } = await import("../src/core/storage");
  const note = await createNote({
    type: "research", title: "docs", body_html: "<p>x</p>",
    thread_id: "doc", theme: "linen", tags: [],
  });
  await startViewer();
  const r = await fetch(`${viewerUrl}/raw/${note.id}`);
  const html = await r.text();
  expect(html).not.toContain("toggleFullscreen");
  expect(html).not.toContain(".slide.is-current");
});

test("/raw/:id of a presentation note with NO .slide sections still injects script — script shows empty-state hint", async () => {
  await setup();
  const { createNote } = await import("../src/core/storage");
  const note = await createNote({
    type: "presentation", title: "empty deck", theme: "plain",
    body_html: "<p>I forgot to add slide sections.</p>",
    thread_id: "empty", tags: [],
  });
  await startViewer();
  const r = await fetch(`${viewerUrl}/raw/${note.id}`);
  const html = await r.text();
  // Script handles the empty case by injecting a .slide-empty hint
  expect(html).toContain("slide-empty");
  expect(html).toContain('add <section class="slide">');
});

// ─── Note iframe allow="fullscreen" ────────────────────────────────────

test("GET /n/:id renders the body iframe with allow='fullscreen' so F key works in any note", async () => {
  await setup();
  const { createNote } = await import("../src/core/storage");
  const note = await createNote({
    type: "presentation", title: "deck", theme: "plain",
    body_html: `<section class="slide"><h1>x</h1></section>`,
    thread_id: "d", tags: [],
  });
  await startViewer();
  const r = await fetch(`${viewerUrl}/n/${note.id}`);
  const html = await r.text();
  expect(html).toMatch(/<iframe class="note-iframe"[^>]*allow="fullscreen"/);
});

// ─── PRESENTATION_JS shape (white-box checks) ──────────────────────────

test("PRESENTATION_JS handles arrow keys, fullscreen, speaker mode, digit jumps", async () => {
  const { PRESENTATION_JS } = await import("../src/viewer/presentation-render");
  expect(PRESENTATION_JS).toContain("ArrowLeft");
  expect(PRESENTATION_JS).toContain("ArrowRight");
  expect(PRESENTATION_JS).toContain('e.key >= "1" && e.key <= "9"');
  expect(PRESENTATION_JS).toContain("requestFullscreen");
  expect(PRESENTATION_JS).toContain('"is-speaker"');
  expect(PRESENTATION_JS).toContain("isContentEditable");
});

test("PRESENTATION_CSS hides non-current slides and styles speaker notes", async () => {
  const { PRESENTATION_CSS } = await import("../src/viewer/presentation-render");
  expect(PRESENTATION_CSS).toContain(".slide {");
  expect(PRESENTATION_CSS).toContain("display: none");
  expect(PRESENTATION_CSS).toContain(".slide.is-current");
  expect(PRESENTATION_CSS).toContain("aside.notes");
  expect(PRESENTATION_CSS).toContain("body.is-speaker");
  expect(PRESENTATION_CSS).toContain(".slide-nav");
});

// ─── MCP allow-list ────────────────────────────────────────────────────

test("NoteType union includes 'presentation' (createNote round-trip)", async () => {
  // createNote() asserts the type ends up in the DB; this is the simpler
  // version of the MCP enum-allowlist check — both surfaces read from the
  // same NoteType union in src/core/types.ts.
  await setup();
  const { createNote, getNoteMeta } = await import("../src/core/storage");
  const note = await createNote({
    type: "presentation",
    title: "type-allow-list",
    body_html: `<section class="slide"><h1>x</h1></section>`,
    thread_id: "t", theme: "plain", tags: [],
  });
  expect(getNoteMeta(note.id)?.type).toBe("presentation");
});
