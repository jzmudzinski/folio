/**
 * Step 2 of the append-only relaxation (v0.22.0): the `replace` primitive.
 * Creates a new note in the same thread + sets the old's superseded_by
 * pointer. The old .html file stays verbatim; listings hide the old one.
 */

import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDb } from "../src/core/db";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "folio-replace-"));
  process.env.FOLIO_HOME = tmpDir;
});

afterEach(() => {
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function newNote(title = "Original", body = "<p class=\"lead\">Original body.</p>") {
  const { init } = await import("../src/cli/commands/init");
  await init();
  const { createNote } = await import("../src/core/storage");
  return await createNote({
    type: "research",
    title,
    body_html: body,
    thread_id: "replace-test",
    theme: "linen",
    tags: ["a", "b"],
  });
}

test("replaceNote creates a new note in the same thread and marks the old as superseded", async () => {
  const { replaceNote, getNoteMeta } = await import("../src/core/storage");
  const old = await newNote();
  const result = await replaceNote({
    old_id: old.id,
    body_html: "<p class=\"lead\">Updated body.</p>",
  });
  expect(result.ok).toBe(true);
  expect(result.old_id).toBe(old.id);
  expect(result.new_meta!.id).not.toBe(old.id);
  expect(result.new_meta!.thread_id).toBe(old.thread_id);

  // Old note now has superseded_by pointing at new
  const oldFresh = getNoteMeta(old.id)!;
  expect(oldFresh.superseded_by).toBe(result.new_meta!.id);

  // New note is the head (superseded_by null)
  const newFresh = getNoteMeta(result.new_meta!.id)!;
  expect(newFresh.superseded_by).toBeNull();
});

test("replaceNote preserves the OLD note's html file verbatim (capability URL stable)", async () => {
  const { replaceNote, getNoteMeta, folioRoot } = {
    ...(await import("../src/core/storage")),
    folioRoot: (await import("../src/core/config")).folioRoot,
  };
  const old = await newNote("Stable URL note", "<p class=\"lead\">Body that downstream linked to.</p>");
  const oldHtmlBefore = readFileSync(join(folioRoot(), old.path), "utf-8");

  await replaceNote({ old_id: old.id, body_html: "<p>Brand new.</p>" });

  // File on disk unchanged
  const oldHtmlAfter = readFileSync(join(folioRoot(), old.path), "utf-8");
  expect(oldHtmlAfter).toBe(oldHtmlBefore);
  // Still contains the original body
  expect(oldHtmlAfter).toContain("Body that downstream linked to");
});

test("replaceNote inherits type/theme/tags/title when not overridden", async () => {
  const { replaceNote, getNoteMeta } = await import("../src/core/storage");
  const old = await newNote();
  const result = await replaceNote({ old_id: old.id, body_html: "<p>Same metadata.</p>" });
  expect(result.ok).toBe(true);
  const newMeta = getNoteMeta(result.new_meta!.id)!;
  expect(newMeta.title).toBe(old.title);
  expect(newMeta.type).toBe(old.type);
  expect(newMeta.theme).toBe(old.theme);
  expect(newMeta.tags.sort()).toEqual(old.tags.sort());
});

test("replaceNote applies overrides when passed", async () => {
  const { replaceNote, getNoteMeta } = await import("../src/core/storage");
  const old = await newNote();
  const result = await replaceNote({
    old_id: old.id,
    body_html: "<p>Polished.</p>",
    title: "New title",
    theme: "folio",
    tags: ["polished"],
  });
  expect(result.ok).toBe(true);
  const newMeta = getNoteMeta(result.new_meta!.id)!;
  expect(newMeta.title).toBe("New title");
  expect(newMeta.theme).toBe("folio");
  expect(newMeta.tags).toEqual(["polished"]);
});

test("listNotes hides superseded notes by default + reveals them with include_superseded:true", async () => {
  const { replaceNote, listNotes } = await import("../src/core/storage");
  const old = await newNote();
  const result = await replaceNote({ old_id: old.id, body_html: "<p>Replaced.</p>" });

  const defaultList = listNotes({ thread_id: "replace-test" });
  expect(defaultList.length).toBe(1);
  expect(defaultList[0]!.id).toBe(result.new_meta!.id);

  const fullList = listNotes({ thread_id: "replace-test", include_superseded: true });
  expect(fullList.length).toBe(2);
  expect(fullList.map((n) => n.id).sort()).toEqual([old.id, result.new_meta!.id].sort());
});

test("listThreads counts only head notes per thread (3-note thread after 2 replaces shows count=1)", async () => {
  const { replaceNote, listThreads } = await import("../src/core/storage");
  const v1 = await newNote();
  const r1 = await replaceNote({ old_id: v1.id, body_html: "<p>v2.</p>" });
  const r2 = await replaceNote({ old_id: r1.new_meta!.id, body_html: "<p>v3.</p>" });
  expect(r2.ok).toBe(true);

  const threads = listThreads();
  const t = threads.find((x) => x.thread_id === "replace-test");
  expect(t).toBeDefined();
  expect(t!.count).toBe(1); // only the head shows up
});

test("searchNotes hides superseded notes by default", async () => {
  const { replaceNote, searchNotes } = await import("../src/core/storage");
  const v1 = await newNote("Findable original", "<p>Searchable token: kumquatxyz.</p>");
  await replaceNote({ old_id: v1.id, body_html: "<p>Different content, no token.</p>" });

  // Search for the old-only token: default mode finds nothing (old is hidden)
  const defaultHits = searchNotes({ query: "kumquatxyz", limit: 10 });
  expect(defaultHits.length).toBe(0);

  // include_superseded → finds the old version
  const fullHits = searchNotes({ query: "kumquatxyz", limit: 10, include_superseded: true });
  expect(fullHits.length).toBe(1);
  expect(fullHits[0]!.id).toBe(v1.id);
});

test("listNotesByTag hides superseded notes", async () => {
  const { replaceNote, listNotesByTag } = await import("../src/core/storage");
  const v1 = await newNote();
  const r1 = await replaceNote({ old_id: v1.id, body_html: "<p>v2.</p>" });

  // Both versions carry tag "a" (inherited)
  const byTag = listNotesByTag("a", 100);
  expect(byTag.length).toBe(1);
  expect(byTag[0]!.id).toBe(r1.new_meta!.id);
});

test("replaceNote returns ok:false reason:'already-superseded' when replacing an already-superseded note", async () => {
  const { replaceNote } = await import("../src/core/storage");
  const v1 = await newNote();
  await replaceNote({ old_id: v1.id, body_html: "<p>v2.</p>" });
  // Try to replace v1 again
  const second = await replaceNote({ old_id: v1.id, body_html: "<p>v2 bis.</p>" });
  expect(second.ok).toBe(false);
  expect(second.reason).toBe("already-superseded");
});

test("replaceNote returns ok:false reason:'not-found' on bad id", async () => {
  const { init } = await import("../src/cli/commands/init");
  await init();
  const { replaceNote } = await import("../src/core/storage");
  const result = await replaceNote({ old_id: "01NONEXISTENT0000000000000", body_html: "<p>x</p>" });
  expect(result.ok).toBe(false);
  expect(result.reason).toBe("not-found");
});

test("resolveHeadOfChain walks through multiple replaces to the current head", async () => {
  const { replaceNote, resolveHeadOfChain } = await import("../src/core/storage");
  const v1 = await newNote();
  const r1 = await replaceNote({ old_id: v1.id, body_html: "<p>v2.</p>" });
  const r2 = await replaceNote({ old_id: r1.new_meta!.id, body_html: "<p>v3.</p>" });
  const r3 = await replaceNote({ old_id: r2.new_meta!.id, body_html: "<p>v4.</p>" });

  // Starting from v1, walk to v4
  const head = resolveHeadOfChain(v1.id);
  expect(head).not.toBeNull();
  expect(head!.id).toBe(r3.new_meta!.id);
});

test("viewer pageNote renders supersede banner with link to head when visiting old URL", async () => {
  const { replaceNote, getNoteMeta } = await import("../src/core/storage");
  const { pageNote } = await import("../src/viewer/render");
  const v1 = await newNote("Old version");
  const r1 = await replaceNote({ old_id: v1.id, body_html: "<p>v2.</p>", title: "New version" });

  const oldFresh = getNoteMeta(v1.id)!;
  const html = pageNote(oldFresh, oldFresh.theme);
  expect(html).toContain("supersede-banner");
  expect(html).toContain("Replaced");
  expect(html).toContain(`href="/n/${r1.new_meta!.id}"`);
  expect(html).toContain("New version");
});

test("viewer pageNote on head note does NOT render supersede banner", async () => {
  const { replaceNote, getNoteMeta } = await import("../src/core/storage");
  const { pageNote } = await import("../src/viewer/render");
  const v1 = await newNote();
  const r1 = await replaceNote({ old_id: v1.id, body_html: "<p>v2.</p>" });

  const headFresh = getNoteMeta(r1.new_meta!.id)!;
  const html = pageNote(headFresh, headFresh.theme);
  // The class name appears in <style> at top of every page; check for the
  // actual banner DIV instead (uses the class on a real element).
  expect(html).not.toMatch(/<div class="note-banner supersede-banner">/);
});

test("supersede event is logged", async () => {
  const { replaceNote } = await import("../src/core/storage");
  const { db } = await import("../src/core/db");
  const v1 = await newNote();
  const r1 = await replaceNote({ old_id: v1.id, body_html: "<p>v2.</p>" });

  const events = db()
    .query<{ kind: string; data: string; note_id: string }, []>(
      "SELECT kind, data, note_id FROM events WHERE kind = 'note_superseded' ORDER BY id DESC"
    )
    .all();
  expect(events.length).toBe(1);
  expect(events[0]!.note_id).toBe(v1.id);
  const data = JSON.parse(events[0]!.data);
  expect(data.replaced_with).toBe(r1.new_meta!.id);
});

test("getRevisionChain on a never-replaced note returns just itself", async () => {
  const { getRevisionChain } = await import("../src/core/storage");
  const v1 = await newNote();
  const chain = getRevisionChain(v1.id);
  expect(chain.map((m) => m.id)).toEqual([v1.id]);
  expect(chain[0]!.superseded_by).toBeNull();
});

test("getRevisionChain returns the full chain oldest→newest from ANY id in it", async () => {
  const { replaceNote, getRevisionChain } = await import("../src/core/storage");
  const v1 = await newNote();
  const r1 = await replaceNote({ old_id: v1.id, body_html: "<p>v2.</p>" });
  const r2 = await replaceNote({ old_id: r1.new_meta!.id, body_html: "<p>v3.</p>" });
  const expected = [v1.id, r1.new_meta!.id, r2.new_meta!.id];

  // Querying from the root, the middle, or the head yields the same ordered chain.
  for (const startId of expected) {
    const chain = getRevisionChain(startId);
    expect(chain.map((m) => m.id)).toEqual(expected);
  }
  // Only the last (head) has a null superseded_by.
  const headChain = getRevisionChain(v1.id);
  expect(headChain[headChain.length - 1]!.superseded_by).toBeNull();
  expect(headChain[0]!.superseded_by).toBe(r1.new_meta!.id);
});

test("viewer pageNote renders the revisions strip for a chain, current + head marked", async () => {
  const { replaceNote, getNoteMeta } = await import("../src/core/storage");
  const { pageNote } = await import("../src/viewer/render");
  const v1 = await newNote();
  const r1 = await replaceNote({ old_id: v1.id, body_html: "<p>v2.</p>" });

  // Viewing the OLD revision: strip present, v1 is current, v2 is head (★).
  const oldFresh = getNoteMeta(v1.id)!;
  const html = pageNote(oldFresh, oldFresh.theme);
  expect(html).toContain('<nav class="revisions"');
  expect(html).toContain("Revisions · 2");
  expect(html).toContain(`href="/n/${v1.id}"`);
  expect(html).toContain(`href="/n/${r1.new_meta!.id}"`);
  // The viewed (old) revision carries the .cur marker.
  expect(html).toMatch(new RegExp(`rev-chip cur[^"]*" href="/n/${v1.id}"`));
});

test("viewer pageNote renders NO revisions strip for a single-revision note", async () => {
  const { getNoteMeta } = await import("../src/core/storage");
  const { pageNote } = await import("../src/viewer/render");
  const v1 = await newNote();
  const html = pageNote(getNoteMeta(v1.id)!, v1.theme);
  expect(html).not.toContain('<nav class="revisions"');
});
