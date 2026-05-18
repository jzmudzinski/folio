/**
 * v0.22.2 — inline metadata editing in the viewer (the popover from
 * v0.22.1 was replaced). Coverage:
 *   - `.editable-title` h1 with data-note-id (click-to-edit affordance)
 *   - `.tag-editor` with chip × remove buttons + add input + suggest box
 *   - Theme dropdown's "Save as default" link present
 *   - inlineMetadataEditorJs embeds popular tags + posts to the existing
 *     POST /api/notes/:id/metadata endpoint
 *   - the endpoint itself (happy path, no-change, unknown-theme, bad id)
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
  tmpDir = mkdtempSync(join(tmpdir(), "folio-edit-ui-"));
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
  const { createNote } = await import("../src/core/storage");
  return await createNote({
    type: "research",
    title: "Edit UI sample",
    body_html: "<p class=\"lead\">Body.</p>",
    thread_id: "edit-ui",
    theme: "linen",
    tags: ["alpha", "beta"],
  });
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

// ─── inline UI presence ─────────────────────────────────────────────────

test("pageNote renders the editable title h1 with data-note-id", async () => {
  const { pageNote } = await import("../src/viewer/render");
  const { getNoteMeta } = await import("../src/core/storage");
  const note = await setup();
  const html = pageNote(getNoteMeta(note.id)!, note.theme);
  expect(html).toMatch(/<h1 class="editable-title" data-note-id="[^"]+" tabindex="0"/);
  expect(html).toContain("Edit UI sample");
});

test("pageNote renders the tag editor with chips + remove buttons + add input", async () => {
  const { pageNote } = await import("../src/viewer/render");
  const { getNoteMeta } = await import("../src/core/storage");
  const note = await setup();
  const html = pageNote(getNoteMeta(note.id)!, note.theme);
  expect(html).toContain('class="tag-editor"');
  expect(html).toMatch(/<span class="tag-chip" data-tag="alpha">/);
  expect(html).toMatch(/<span class="tag-chip" data-tag="beta">/);
  expect(html).toMatch(/<button type="button" class="tag-remove" data-tag="alpha"/);
  expect(html).toMatch(/<button type="button" class="tag-remove" data-tag="beta"/);
  expect(html).toContain('class="tag-add-input"');
  expect(html).toContain('class="tag-suggest"');
});

test("pageNote tag editor present even when note has zero tags (just the +add input)", async () => {
  const { init } = await import("../src/cli/commands/init");
  await init();
  const { createNote, getNoteMeta } = await import("../src/core/storage");
  const { pageNote } = await import("../src/viewer/render");
  const note = await createNote({
    type: "snippet",
    title: "Tagless",
    body_html: "<p>.</p>",
    thread_id: "tagless",
    theme: "linen",
    tags: [],
  });
  const html = pageNote(getNoteMeta(note.id)!, note.theme);
  expect(html).toContain('class="tag-editor"');
  expect(html).toContain('class="tag-add-input"');
  // No chips
  expect(html).not.toContain('class="tag-chip"');
});

test("pageNote theme dropdown has a 'Save as default' link (initially hidden)", async () => {
  const { pageNote } = await import("../src/viewer/render");
  const { getNoteMeta } = await import("../src/core/storage");
  const note = await setup();
  const html = pageNote(getNoteMeta(note.id)!, note.theme);
  expect(html).toContain('class="theme-row"');
  expect(html).toMatch(/<a href="#" class="theme-save" data-note-id="[^"]+" hidden>/);
  expect(html).toContain("Save as default");
});

test("inlineMetadataEditorJs embeds popular tags as a constant + POSTs to /metadata", async () => {
  const { pageNote } = await import("../src/viewer/render");
  const { getNoteMeta } = await import("../src/core/storage");
  const note = await setup();
  const html = pageNote(getNoteMeta(note.id)!, note.theme);
  expect(html).toContain("var popularTags =");
  expect(html).toContain("/api/notes/' + encodeURIComponent(noteId) + '/metadata");
  expect(html).toContain("contenteditable");
  expect(html).toContain("ArrowDown"); // keyboard nav in suggest box
});

test("pageNote no longer renders the v0.22.1 Edit metadata popover", async () => {
  const { pageNote } = await import("../src/viewer/render");
  const { getNoteMeta } = await import("../src/core/storage");
  const note = await setup();
  const html = pageNote(getNoteMeta(note.id)!, note.theme);
  expect(html).not.toMatch(/id="edit-trigger"/);
  expect(html).not.toMatch(/id="edit-pop"/);
  expect(html).not.toContain("✎ Edit metadata");
});

// ─── endpoint (unchanged from v0.22.1) ──────────────────────────────────

test("POST /api/notes/:id/metadata happy path: updates fields, returns meta", async () => {
  const note = await setup();
  await startViewer();
  const r = await fetch(`${viewerUrl}/api/notes/${note.id}/metadata`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Renamed", tags: ["x", "y"] }),
  });
  expect(r.status).toBe(200);
  const data = (await r.json()) as any;
  expect(data.ok).toBe(true);
  expect(data.updated_fields.sort()).toEqual(["tags", "title"]);
  expect(data.meta.title).toBe("Renamed");
  expect(data.meta.tags.sort()).toEqual(["x", "y"]);
});

test("POST /api/notes/:id/metadata theme change rewrites the HTML <link> + DB row", async () => {
  const { getNoteMeta, readNoteHtml } = await import("../src/core/storage");
  const note = await setup();
  await startViewer();
  const r = await fetch(`${viewerUrl}/api/notes/${note.id}/metadata`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ theme: "folio" }),
  });
  expect(r.status).toBe(200);
  const meta = getNoteMeta(note.id)!;
  expect(meta.theme).toBe("folio");
  const html = readNoteHtml(meta);
  expect(html).toMatch(/href="\/themes\/folio\/theme\.css"/);
  expect(html).not.toMatch(/href="\/themes\/linen\/theme\.css"/);
});

test("POST /api/notes/:id/metadata no-change returns ok:false reason:'no-change' with 200", async () => {
  const note = await setup();
  await startViewer();
  const r = await fetch(`${viewerUrl}/api/notes/${note.id}/metadata`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: note.title }),
  });
  expect(r.status).toBe(200);
  const data = (await r.json()) as any;
  expect(data.ok).toBe(false);
  expect(data.reason).toBe("no-change");
});

test("POST /api/notes/:id/metadata unknown theme returns 400", async () => {
  const note = await setup();
  await startViewer();
  const r = await fetch(`${viewerUrl}/api/notes/${note.id}/metadata`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ theme: "no-such-theme" }),
  });
  expect(r.status).toBe(400);
  const data = (await r.json()) as any;
  expect(data.ok).toBe(false);
  expect(data.reason).toBe("unknown-theme");
});

test("POST /api/notes/:id/metadata bad id returns 404", async () => {
  await setup();
  await startViewer();
  const r = await fetch(`${viewerUrl}/api/notes/01NONEXISTENT0000000000000/metadata`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Doesn't matter" }),
  });
  expect(r.status).toBe(404);
});

test("inline tag remove → POST /metadata with smaller tags array → 200", async () => {
  // Simulates what the × button on a tag chip does: POST the kept-tags list.
  const { getNoteMeta } = await import("../src/core/storage");
  const note = await setup();
  await startViewer();
  const r = await fetch(`${viewerUrl}/api/notes/${note.id}/metadata`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tags: ["alpha"] }),
  });
  expect(r.status).toBe(200);
  const meta = getNoteMeta(note.id)!;
  expect(meta.tags).toEqual(["alpha"]);
});

test("inline tag add → POST /metadata with bigger tags array → 200", async () => {
  // Simulates what the +add input does on Enter: POST the merged list.
  const { getNoteMeta } = await import("../src/core/storage");
  const note = await setup();
  await startViewer();
  const r = await fetch(`${viewerUrl}/api/notes/${note.id}/metadata`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tags: ["alpha", "beta", "gamma"] }),
  });
  expect(r.status).toBe(200);
  const meta = getNoteMeta(note.id)!;
  expect(meta.tags.sort()).toEqual(["alpha", "beta", "gamma"]);
});
