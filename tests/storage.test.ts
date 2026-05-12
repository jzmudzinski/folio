import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDb } from "../src/core/db";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "folio-test-"));
  process.env.FOLIO_HOME = tmpDir;
});

afterEach(() => {
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
});

test("init + create + list + search round-trip", async () => {
  const { init } = await import("../src/cli/commands/init");
  const { createNote, listNotes, searchNotes } = await import("../src/core/storage");

  expect(await init()).toBe(0);

  const note = await createNote({
    type: "research",
    title: "RAG vs Fine-Tuning",
    body_html: '<p class="lead">Krótkie porównanie.</p><h3>TL;DR</h3><p>RAG dla świeżych danych.</p>',
    thread_id: "rag",
    tags: ["ai", "rag"],
  });

  expect(note.id).toBeTruthy();
  expect(note.theme).toBe("linen");
  expect(note.is_final).toBe(false);
  expect(note.expires_at).toBeTruthy();

  const all = listNotes({});
  expect(all.length).toBe(1);
  expect(all[0]!.title).toBe("RAG vs Fine-Tuning");

  const hits = searchNotes({ query: "swiezych" });
  expect(hits.length).toBe(1);
  expect(hits[0]!.snippet).toContain("<mark>");
});

test("slug uniqueness in same thread", async () => {
  const { init } = await import("../src/cli/commands/init");
  const { createNote } = await import("../src/core/storage");
  await init();

  const a = await createNote({ type: "snippet", title: "Test", body_html: "<p>x</p>", thread_id: "t" });
  const b = await createNote({ type: "snippet", title: "Test", body_html: "<p>y</p>", thread_id: "t" });

  expect(a.slug).toBe("test");
  expect(b.slug).toBe("test-2");
  expect(a.id).not.toBe(b.id);
});

test("finalize clears expires_at", async () => {
  const { init } = await import("../src/cli/commands/init");
  const { createNote, finalize, getNoteMeta } = await import("../src/core/storage");
  await init();

  const note = await createNote({ type: "snippet", title: "Mark me", body_html: "<p>x</p>" });
  expect(note.expires_at).toBeTruthy();
  expect(finalize(note.id)).toBe(true);
  const after = getNoteMeta(note.id);
  expect(after?.is_final).toBe(true);
  expect(after?.expires_at).toBeNull();
});

test("listPopularTags returns counts >= 2 sorted desc; listNotesByTag returns chronological", async () => {
  const { init } = await import("../src/cli/commands/init");
  const { createNote, listPopularTags, listNotesByTag } = await import("../src/core/storage");
  await init();

  await createNote({ type: "snippet", title: "A", body_html: "<p>a</p>", tags: ["klient:foo", "saas"] });
  await createNote({ type: "snippet", title: "B", body_html: "<p>b</p>", tags: ["klient:foo", "saas", "ai"] });
  await createNote({ type: "snippet", title: "C", body_html: "<p>c</p>", tags: ["saas"] });
  await createNote({ type: "snippet", title: "D", body_html: "<p>d</p>", tags: ["only-once"] });

  const top = listPopularTags(10);
  const counts = Object.fromEntries(top.map((t) => [t.tag, t.count]));
  expect(counts["saas"]).toBe(3);
  expect(counts["klient:foo"]).toBe(2);
  expect(counts["only-once"]).toBeUndefined(); // singletons excluded
  expect(counts["ai"]).toBeUndefined();
  expect(top[0]!.tag).toBe("saas"); // highest count first

  const klient = listNotesByTag("klient:foo");
  expect(klient.map((n) => n.title)).toEqual(["B", "A"]); // newest first
});

test("listNotes combined filter: tag + type narrows correctly", async () => {
  const { init } = await import("../src/cli/commands/init");
  const { createNote, listNotes } = await import("../src/core/storage");
  await init();

  await createNote({ type: "research",   title: "R-foo", body_html: "<p>x</p>", tags: ["klient:foo", "saas"] });
  await createNote({ type: "comparison", title: "C-foo", body_html: "<p>x</p>", tags: ["klient:foo"] });
  await createNote({ type: "research",   title: "R-bar", body_html: "<p>x</p>", tags: ["klient:bar"] });
  await createNote({ type: "research",   title: "R-untagged", body_html: "<p>x</p>" });

  // tag only
  const byTag = listNotes({ tag: "klient:foo" });
  expect(byTag.map((n) => n.title).sort()).toEqual(["C-foo", "R-foo"]);

  // tag + type
  const byBoth = listNotes({ tag: "klient:foo", type: "research" });
  expect(byBoth.map((n) => n.title)).toEqual(["R-foo"]);

  // type only (existing behavior unchanged)
  const byType = listNotes({ type: "research" });
  expect(byType.map((n) => n.title).sort()).toEqual(["R-bar", "R-foo", "R-untagged"]);

  // no filter
  expect(listNotes({}).length).toBe(4);
});

test("classes from theme stylebook tracked in analytics", async () => {
  const { init } = await import("../src/cli/commands/init");
  const { createNote } = await import("../src/core/storage");
  const { db } = await import("../src/core/db");
  await init();

  await createNote({
    type: "research",
    title: "Class test",
    body_html: '<span class="eyebrow">x</span><h1>y</h1><p class="lead">z</p>',
  });

  const ev = db()
    .query<{ data: string }, []>("SELECT data FROM events WHERE kind = 'note_created'")
    .get();
  expect(ev).toBeTruthy();
  const payload = JSON.parse(ev!.data);
  expect(payload.class_count).toBeGreaterThanOrEqual(2);
  expect(payload.inline_style_count).toBe(0);
});
