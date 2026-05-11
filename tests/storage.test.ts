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
