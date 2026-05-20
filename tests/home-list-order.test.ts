/**
 * v0.29.3 regression guard — home list section ordering.
 *
 * Bug: v0.29.0's pinned sort (`is_pinned DESC, pinned_at DESC, created DESC`)
 * floats a pinned older note to the front of the notes array. pageList built
 * its date groups by Map insertion order, so a pinned note from *yesterday*
 * seeded the "Yesterday" group first → it rendered ABOVE "Today".
 *
 * Fix: pinned notes get their own section on top; date groups are sorted
 * strictly newest-first independent of array order. These tests pin that:
 *   - "Today" always renders before "Yesterday"
 *   - pinned notes appear in a "Pinned" section above all date groups
 *   - pinned notes are NOT duplicated into their date group
 */

import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDb } from "../src/core/db";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "folio-list-order-"));
  process.env.FOLIO_HOME = tmpDir;
});

afterEach(() => {
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
});

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

async function setup() {
  const { init } = await import("../src/cli/commands/init");
  await init();
  return await import("../src/core/storage");
}

const COUNTS = { all: 0, final: 0, expiring: 0, pinned: 0, byType: {} as Record<string, number> };

test("Today renders before Yesterday even with a pinned yesterday note", async () => {
  const storage = await setup();
  const { createNote, updateNoteMetadata, listNotes } = storage;
  const { db } = await import("../src/core/db");
  const { pageList } = await import("../src/viewer/render");

  const a = await createNote({ type: "research", title: "AAA pinned-yesterday", body_html: "<p>a</p>", thread_id: "t" });
  const b = await createNote({ type: "snippet", title: "BBB today", body_html: "<p>b</p>", thread_id: "t" });
  const d = await createNote({ type: "technical", title: "DDD yesterday-plain", body_html: "<p>d</p>", thread_id: "t" });

  // Backdate A and D to yesterday; A is the one that used to break ordering.
  db().run("UPDATE notes SET created=? WHERE id=?", [isoDaysAgo(1), a.id]);
  db().run("UPDATE notes SET created=? WHERE id=?", [isoDaysAgo(1), d.id]);
  await updateNoteMetadata({ id: a.id, is_pinned: true });

  const html = pageList(listNotes({ limit: 100 }), COUNTS);

  const iPinned = html.indexOf("Pinned");
  const iToday = html.indexOf("Today");
  const iYesterday = html.indexOf("Yesterday");

  expect(iPinned).toBeGreaterThanOrEqual(0);
  expect(iToday).toBeGreaterThanOrEqual(0);
  expect(iYesterday).toBeGreaterThanOrEqual(0);
  // Pinned section first, then Today, then Yesterday.
  expect(iPinned).toBeLessThan(iToday);
  expect(iToday).toBeLessThan(iYesterday);
});

test("pinned note appears in the Pinned section, not duplicated in its date group", async () => {
  const storage = await setup();
  const { createNote, updateNoteMetadata, listNotes } = storage;
  const { db } = await import("../src/core/db");
  const { pageList } = await import("../src/viewer/render");

  const a = await createNote({ type: "research", title: "UNIQUEPIN", body_html: "<p>a</p>", thread_id: "t" });
  await createNote({ type: "snippet", title: "plain-today", body_html: "<p>b</p>", thread_id: "t" });
  db().run("UPDATE notes SET created=? WHERE id=?", [isoDaysAgo(1), a.id]);
  await updateNoteMetadata({ id: a.id, is_pinned: true });

  const html = pageList(listNotes({ limit: 100 }), { ...COUNTS, pinned: 1 });

  // Title appears exactly once — pinned section only, not also in "Yesterday".
  const occurrences = html.split("UNIQUEPIN").length - 1;
  expect(occurrences).toBe(1);
});

test("plain date ordering (no pins) keeps Today before Yesterday", async () => {
  const storage = await setup();
  const { createNote, listNotes } = storage;
  const { db } = await import("../src/core/db");
  const { pageList } = await import("../src/viewer/render");

  await createNote({ type: "snippet", title: "today-note", body_html: "<p>b</p>", thread_id: "t" });
  const y = await createNote({ type: "technical", title: "yesterday-note", body_html: "<p>d</p>", thread_id: "t" });
  db().run("UPDATE notes SET created=? WHERE id=?", [isoDaysAgo(1), y.id]);

  const html = pageList(listNotes({ limit: 100 }), COUNTS);
  expect(html.indexOf("Today")).toBeLessThan(html.indexOf("Yesterday"));
});
