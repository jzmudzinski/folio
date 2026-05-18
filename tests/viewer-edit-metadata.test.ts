/**
 * v0.22 — viewer-side Edit metadata UI + API endpoint.
 *
 * Two surfaces under test:
 *   1. POST /api/notes/:id/metadata — accepts JSON {title, tags, theme,
 *      is_final}, returns {ok, updated_fields, meta} or {ok:false, reason}.
 *   2. pageNote() renders the `#edit-trigger` button in .side-aux, the
 *      `#edit-pop` popover with inputs prefilled to current values, and
 *      the editMetadataPopoverJs handler that wires the form.
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
  // Force ephemeral viewer port via config.
  const cfgPath = join(tmpDir, "folio.config.json");
  const parsed = JSON.parse(readFileSync(cfgPath, "utf-8"));
  parsed.viewer_port = 0;
  writeFileSync(cfgPath, JSON.stringify(parsed));
  const { startServer } = await import("../src/viewer/server");
  viewer = (await startServer()) as any;
  viewerUrl = `http://${viewer!.hostname}:${viewer!.port}`;
}

test("pageNote renders the Edit metadata trigger in .side-aux", async () => {
  const { pageNote } = await import("../src/viewer/render");
  const { getNoteMeta } = await import("../src/core/storage");
  const note = await setup();
  const html = pageNote(getNoteMeta(note.id)!, note.theme);
  expect(html).toContain('id="edit-trigger"');
  expect(html).toContain("Edit metadata");
});

test("pageNote renders the edit popover with current values prefilled", async () => {
  const { pageNote } = await import("../src/viewer/render");
  const { getNoteMeta } = await import("../src/core/storage");
  const note = await setup();
  const html = pageNote(getNoteMeta(note.id)!, note.theme);
  expect(html).toContain('id="edit-pop"');
  expect(html).toContain('id="edit-title"');
  expect(html).toContain('id="edit-tags"');
  expect(html).toContain('id="edit-theme"');
  expect(html).toContain('id="edit-final"');
  // Prefill: title + tags + theme selected
  expect(html).toContain('value="Edit UI sample"');
  expect(html).toContain('value="alpha, beta"');
  expect(html).toMatch(/<option value="linen" selected>linen<\/option>/);
});

test("pageNote popover JS posts to /api/notes/:id/metadata and reloads on success", async () => {
  const { pageNote } = await import("../src/viewer/render");
  const { getNoteMeta } = await import("../src/core/storage");
  const note = await setup();
  const html = pageNote(getNoteMeta(note.id)!, note.theme);
  expect(html).toContain("/api/notes/' + encodeURIComponent(noteId) + '/metadata");
  expect(html).toContain("window.location.reload()");
});

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
