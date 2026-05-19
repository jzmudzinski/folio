/**
 * v0.29 — user-pinned notes. is_pinned floats notes to the top of the
 * default listing; pinned_at orders multiple pinned (freshly pinned
 * floats above long-pinned). These tests pin the contract:
 *   - migration adds the columns (already covered by db init)
 *   - updateNoteMetadata accepts is_pinned, stamps pinned_at, no body rewrite
 *   - listNotes default sort floats pinned to the top
 *   - thread view stays chronological (no pin bias)
 *   - is_pinned filter returns only pinned
 *   - replace carries pin forward to the new head
 */

import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDb } from "../src/core/db";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "folio-pinned-"));
  process.env.FOLIO_HOME = tmpDir;
});

afterEach(() => {
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function setup() {
  const { init } = await import("../src/cli/commands/init");
  await init();
  return await import("../src/core/storage");
}

async function makeNote(opts: { title: string; thread_id?: string; tags?: string[] }) {
  const { createNote } = await import("../src/core/storage");
  return await createNote({
    type: "research",
    title: opts.title,
    body_html: `<p>Body of ${opts.title}</p>`,
    thread_id: opts.thread_id ?? "pinned-test",
    theme: "linen",
    tags: opts.tags ?? [],
  });
}

test("createNote returns is_pinned=false and pinned_at=null by default", async () => {
  await setup();
  const note = await makeNote({ title: "Fresh note" });
  expect(note.is_pinned).toBe(false);
  expect(note.pinned_at).toBeNull();
});

test("updateNoteMetadata is_pinned=true stamps pinned_at and flips the flag", async () => {
  const { updateNoteMetadata, getNoteMeta } = await setup();
  const note = await makeNote({ title: "To pin" });
  const before = Date.now();
  const result = await updateNoteMetadata({ id: note.id, is_pinned: true });
  expect(result.ok).toBe(true);
  expect(result.updated_fields).toEqual(["is_pinned"]);
  const fresh = getNoteMeta(note.id)!;
  expect(fresh.is_pinned).toBe(true);
  expect(fresh.pinned_at).not.toBeNull();
  const pinnedAtMs = new Date(fresh.pinned_at!).getTime();
  expect(pinnedAtMs).toBeGreaterThanOrEqual(before - 5);
  expect(pinnedAtMs).toBeLessThanOrEqual(Date.now() + 5);
});

test("updateNoteMetadata is_pinned=false clears pinned_at", async () => {
  const { updateNoteMetadata, getNoteMeta } = await setup();
  const note = await makeNote({ title: "Pin then unpin" });
  await updateNoteMetadata({ id: note.id, is_pinned: true });
  expect(getNoteMeta(note.id)!.is_pinned).toBe(true);
  const unpin = await updateNoteMetadata({ id: note.id, is_pinned: false });
  expect(unpin.ok).toBe(true);
  const after = getNoteMeta(note.id)!;
  expect(after.is_pinned).toBe(false);
  expect(after.pinned_at).toBeNull();
});

test("pin-only update does NOT rewrite the .html file on disk", async () => {
  const { updateNoteMetadata, getNoteMeta } = await setup();
  const note = await makeNote({ title: "No body rewrite" });
  const meta = getNoteMeta(note.id)!;
  const absPath = join(tmpDir, meta.path);
  const beforeBytes = readFileSync(absPath);
  await new Promise((r) => setTimeout(r, 20)); // give mtime room to differ if it does
  await updateNoteMetadata({ id: note.id, is_pinned: true });
  const afterBytes = readFileSync(absPath);
  expect(afterBytes.equals(beforeBytes)).toBe(true);
});

test("listNotes default sort floats pinned to the top, newest-pinned first", async () => {
  const { listNotes, updateNoteMetadata } = await setup();
  const a = await makeNote({ title: "A (oldest)" });
  await new Promise((r) => setTimeout(r, 5));
  const b = await makeNote({ title: "B" });
  await new Promise((r) => setTimeout(r, 5));
  const c = await makeNote({ title: "C (newest)" });

  // Pin A first, then B. B was pinned later → B floats above A.
  await updateNoteMetadata({ id: a.id, is_pinned: true });
  await new Promise((r) => setTimeout(r, 5));
  await updateNoteMetadata({ id: b.id, is_pinned: true });

  const all = listNotes({ limit: 100 });
  // Order: B (pinned, freshest pin), A (pinned, older pin), C (unpinned, newest)
  expect(all.map((n) => n.title)).toEqual(["B", "A (oldest)", "C (newest)"]);
});

test("listNotes is_pinned=true returns only pinned", async () => {
  const { listNotes, updateNoteMetadata } = await setup();
  const a = await makeNote({ title: "Pinned A" });
  await makeNote({ title: "Not pinned B" });
  const c = await makeNote({ title: "Pinned C" });
  await updateNoteMetadata({ id: a.id, is_pinned: true });
  await updateNoteMetadata({ id: c.id, is_pinned: true });

  const pinned = listNotes({ is_pinned: true, limit: 100 });
  expect(pinned.map((n) => n.title).sort()).toEqual(["Pinned A", "Pinned C"]);
});

test("thread view stays chronological (no pin bias when thread_id is set)", async () => {
  const { listNotes, updateNoteMetadata } = await setup();
  const a = await makeNote({ title: "First in thread", thread_id: "t1" });
  await new Promise((r) => setTimeout(r, 5));
  const b = await makeNote({ title: "Second in thread", thread_id: "t1" });
  await new Promise((r) => setTimeout(r, 5));
  const c = await makeNote({ title: "Third in thread", thread_id: "t1" });

  // Pin the first (oldest) one. Default home would float it up — thread view should not.
  await updateNoteMetadata({ id: a.id, is_pinned: true });

  const inThread = listNotes({ thread_id: "t1", limit: 100 });
  // Chronological DESC: newest first, pin ignored.
  expect(inThread.map((n) => n.title)).toEqual(["Third in thread", "Second in thread", "First in thread"]);
});

test("replaceNote carries pin forward to the new head and clears it on the old row", async () => {
  const { updateNoteMetadata, replaceNote, getNoteMeta } = await setup();
  const original = await makeNote({ title: "Original" });
  await updateNoteMetadata({ id: original.id, is_pinned: true });
  const originalMeta = getNoteMeta(original.id)!;
  expect(originalMeta.is_pinned).toBe(true);
  const originalPinnedAt = originalMeta.pinned_at;

  const replaced = await replaceNote({
    old_id: original.id,
    body_html: "<p>Polished version</p>",
  });
  expect(replaced.ok).toBe(true);
  const newHead = getNoteMeta(replaced.new_meta!.id)!;
  expect(newHead.is_pinned).toBe(true);
  // Carries the original pinned_at — so it doesn't jump to the top on polish.
  expect(newHead.pinned_at).toBe(originalPinnedAt);
  // Old row loses the pin (superseded rows are hidden anyway, but data is consistent).
  const oldRow = getNoteMeta(original.id)!;
  expect(oldRow.is_pinned).toBe(false);
  expect(oldRow.pinned_at).toBeNull();
});

test("no-change detection: setting is_pinned to its current value returns reason='no-change'", async () => {
  const { updateNoteMetadata } = await setup();
  const note = await makeNote({ title: "Already unpinned" });
  // note starts unpinned; setting is_pinned=false is a no-op
  const result = await updateNoteMetadata({ id: note.id, is_pinned: false });
  expect(result.ok).toBe(false);
  expect(result.reason).toBe("no-change");
});
