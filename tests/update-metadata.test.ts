/**
 * Step 1 of the append-only relaxation (v0.22.0): metadata fields on an
 * existing note are now editable in place. Body stays immutable per
 * ADR-014. These tests pin the contract.
 */

import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDb } from "../src/core/db";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "folio-update-meta-"));
  process.env.FOLIO_HOME = tmpDir;
});

afterEach(() => {
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function newNote() {
  const { init } = await import("../src/cli/commands/init");
  await init();
  const { createNote } = await import("../src/core/storage");
  return await createNote({
    type: "research",
    title: "First title",
    body_html: "<p class=\"lead\">Body that must not change.</p><h3>Section</h3><p>More.</p>",
    thread_id: "metadata-edit",
    theme: "linen",
    tags: ["a", "b"],
  });
}

test("updateNoteMetadata changes title and re-renders the HTML, body intact", async () => {
  const { updateNoteMetadata, readNoteHtml, getNoteMeta } = await import("../src/core/storage");
  const note = await newNote();
  const result = await updateNoteMetadata({ id: note.id, title: "Second title" });
  expect(result.ok).toBe(true);
  expect(result.updated_fields).toEqual(["title"]);
  const meta = getNoteMeta(note.id)!;
  expect(meta.title).toBe("Second title");
  const html = readNoteHtml(meta);
  expect(html).toContain("<title>Second title</title>");
  // Body content survives the regeneration.
  expect(html).toContain("Body that must not change.");
  expect(html).toContain("<h3>Section</h3>");
});

test("updateNoteMetadata switches theme — link tag points to new theme.css", async () => {
  const { updateNoteMetadata, readNoteHtml, getNoteMeta } = await import("../src/core/storage");
  const note = await newNote();
  const result = await updateNoteMetadata({ id: note.id, theme: "folio" });
  expect(result.ok).toBe(true);
  expect(result.updated_fields).toEqual(["theme"]);
  const meta = getNoteMeta(note.id)!;
  expect(meta.theme).toBe("folio");
  const html = readNoteHtml(meta);
  expect(html).toMatch(/href="\/themes\/folio\/theme\.css"/);
  expect(html).not.toMatch(/href="\/themes\/linen\/theme\.css"/);
});

test("updateNoteMetadata replaces the tag set wholesale (not additive)", async () => {
  const { updateNoteMetadata, getNoteMeta } = await import("../src/core/storage");
  const note = await newNote();
  // Starting tags ["a", "b"]; replace with ["x", "y", "z"]
  const result = await updateNoteMetadata({ id: note.id, tags: ["x", "y", "z"] });
  expect(result.ok).toBe(true);
  expect(result.updated_fields).toEqual(["tags"]);
  const meta = getNoteMeta(note.id)!;
  expect(meta.tags.sort()).toEqual(["x", "y", "z"]);
  // Old tags are gone (not merged)
  expect(meta.tags).not.toContain("a");
  expect(meta.tags).not.toContain("b");
});

test("updateNoteMetadata empty tags list clears all tags", async () => {
  const { updateNoteMetadata, getNoteMeta } = await import("../src/core/storage");
  const note = await newNote();
  const result = await updateNoteMetadata({ id: note.id, tags: [] });
  expect(result.ok).toBe(true);
  expect(result.updated_fields).toEqual(["tags"]);
  const meta = getNoteMeta(note.id)!;
  expect(meta.tags).toEqual([]);
});

test("updateNoteMetadata is_final flip routes through finalize/unfinalize", async () => {
  const { updateNoteMetadata, getNoteMeta } = await import("../src/core/storage");
  const note = await newNote();
  expect(note.is_final).toBe(false);
  expect(note.expires_at).not.toBeNull();

  const finalized = await updateNoteMetadata({ id: note.id, is_final: true });
  expect(finalized.ok).toBe(true);
  expect(finalized.updated_fields).toEqual(["is_final"]);
  let meta = getNoteMeta(note.id)!;
  expect(meta.is_final).toBe(true);
  expect(meta.expires_at).toBeNull(); // finalize clears expiry

  const unfinalized = await updateNoteMetadata({ id: note.id, is_final: false });
  expect(unfinalized.ok).toBe(true);
  meta = getNoteMeta(note.id)!;
  expect(meta.is_final).toBe(false);
  expect(meta.expires_at).not.toBeNull(); // unfinalize re-arms expiry
});

test("updateNoteMetadata combined multi-field update — single transaction", async () => {
  const { updateNoteMetadata, getNoteMeta, readNoteHtml } = await import("../src/core/storage");
  const note = await newNote();
  const result = await updateNoteMetadata({
    id: note.id,
    title: "Polished title",
    tags: ["polished"],
    theme: "folio",
    is_final: true,
  });
  expect(result.ok).toBe(true);
  expect(result.updated_fields!.sort()).toEqual(["is_final", "tags", "theme", "title"]);
  const meta = getNoteMeta(note.id)!;
  expect(meta.title).toBe("Polished title");
  expect(meta.tags).toEqual(["polished"]);
  expect(meta.theme).toBe("folio");
  expect(meta.is_final).toBe(true);
  const html = readNoteHtml(meta);
  expect(html).toContain("<title>Polished title</title>");
  expect(html).toMatch(/href="\/themes\/folio\//);
});

test("updateNoteMetadata FTS index refreshes — search by new title hits, old title misses", async () => {
  const { updateNoteMetadata, searchNotes } = await import("../src/core/storage");
  const note = await newNote();
  // Sanity: old title is indexed
  expect(searchNotes({ query: "First", limit: 10 }).some((h) => h.id === note.id)).toBe(true);

  await updateNoteMetadata({ id: note.id, title: "Renamed completely" });

  expect(searchNotes({ query: "Renamed", limit: 10 }).some((h) => h.id === note.id)).toBe(true);
  expect(searchNotes({ query: "First", limit: 10 }).some((h) => h.id === note.id)).toBe(false);
});

test("updateNoteMetadata is_final=true on a live note compiles entries into body", async () => {
  const { init } = await import("../src/cli/commands/init");
  await init();
  const { createNote, updateNoteMetadata, getNoteMeta, readNoteHtml } = await import("../src/core/storage");
  const { appendEntry, entriesPath } = await import("../src/core/live");
  const { folioRoot } = await import("../src/core/config");
  const note = await createNote({
    type: "journal",
    title: "Live journal",
    body_html: "<p class=\"lead\">Daily log.</p>",
    thread_id: "live-edit",
    theme: "notebook",
    tags: [],
    live: true,
  });
  const jsonl = entriesPath(join(folioRoot(), note.path));
  appendEntry(jsonl, { content_html: "<p>Morning entry.</p>", tags: [] });
  const result = await updateNoteMetadata({ id: note.id, is_final: true });
  expect(result.ok).toBe(true);
  const meta = getNoteMeta(note.id)!;
  expect(meta.is_final).toBe(true);
  expect(meta.live).toBe(false); // finalize flips live→false
  const html = readNoteHtml(meta);
  expect(html).toContain("Morning entry.");
});

test("updateNoteMetadata returns ok:false reason:'no-change' when nothing differs", async () => {
  const { updateNoteMetadata } = await import("../src/core/storage");
  const note = await newNote();
  const result = await updateNoteMetadata({ id: note.id, title: note.title });
  expect(result.ok).toBe(false);
  expect(result.reason).toBe("no-change");
});

test("updateNoteMetadata returns ok:false reason:'not-found' on bad id", async () => {
  const { init } = await import("../src/cli/commands/init");
  await init();
  const { updateNoteMetadata } = await import("../src/core/storage");
  const result = await updateNoteMetadata({ id: "01NONEXISTENT0000000000000", title: "x" });
  expect(result.ok).toBe(false);
  expect(result.reason).toBe("not-found");
});

test("updateNoteMetadata returns ok:false reason:'unknown-theme' on bad theme", async () => {
  const { updateNoteMetadata } = await import("../src/core/storage");
  const note = await newNote();
  const result = await updateNoteMetadata({ id: note.id, theme: "totally-not-a-theme" });
  expect(result.ok).toBe(false);
  expect(result.reason).toBe("unknown-theme");
});

test("updateNoteMetadata title trimmed; empty title treated as no-change", async () => {
  const { updateNoteMetadata, getNoteMeta } = await import("../src/core/storage");
  const note = await newNote();
  // Whitespace-only title is a no-op
  const empty = await updateNoteMetadata({ id: note.id, title: "   " });
  expect(empty.ok).toBe(false);
  expect(empty.reason).toBe("no-change");
  // Leading/trailing whitespace gets trimmed
  const padded = await updateNoteMetadata({ id: note.id, title: "  Trimmed  " });
  expect(padded.ok).toBe(true);
  const meta = getNoteMeta(note.id)!;
  expect(meta.title).toBe("Trimmed");
});

test("updateNoteMetadata updates `updated` timestamp but leaves `created` alone", async () => {
  const { updateNoteMetadata, getNoteMeta } = await import("../src/core/storage");
  const note = await newNote();
  await new Promise((r) => setTimeout(r, 10));
  await updateNoteMetadata({ id: note.id, title: "Bumped" });
  const meta = getNoteMeta(note.id)!;
  expect(meta.created).toBe(note.created);
  expect(meta.updated).not.toBe(note.created);
  expect(new Date(meta.updated).getTime()).toBeGreaterThan(new Date(note.created).getTime());
});
