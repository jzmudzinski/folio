import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDb, db } from "../src/core/db";

let tmpDir: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "folio-exp-"));
  process.env.FOLIO_HOME = tmpDir;
});
afterEach(() => {
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.FOLIO_HOME;
});

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString();
}

test("expiring filter returns soon-expiring notes even when they're outside the recency LIMIT window", async () => {
  const { init } = await import("../src/cli/commands/init");
  const { createNote, listNotes } = await import("../src/core/storage");
  expect(await init()).toBe(0);

  // Oldest note, made to expire in 2 days.
  const soon = await createNote({ type: "snippet", title: "Expiring soon", body_html: "<p>x</p>", thread_id: "t" });
  db().run("UPDATE notes SET expires_at = ? WHERE id = ?", [daysFromNow(2), soon.id]);

  // A finalized note never expires — must not appear.
  const finalNote = await createNote({ type: "snippet", title: "Final", body_html: "<p>x</p>", thread_id: "t", is_final: true });

  // Several NEWER notes with default (~30 day) expiry — these are the most
  // recent, so a recency-ordered LIMIT window would surface these and hide the
  // older soon-expiring one. That was the bug.
  for (let i = 0; i < 5; i++) {
    await createNote({ type: "snippet", title: `Fresh ${i}`, body_html: "<p>x</p>", thread_id: "t" });
  }

  // Even with a tiny limit, the SQL-level expiring filter scans all notes.
  const expiring = listNotes({ expiring: true, limit: 2 });
  expect(expiring.map((n) => n.id)).toContain(soon.id);
  expect(expiring.map((n) => n.id)).not.toContain(finalNote.id);
  expect(expiring.every((n) => !n.is_final && n.expires_at && new Date(n.expires_at).getTime() - Date.now() < 7 * 86400000)).toBe(true);

  // The default (non-expiring) listing with the same tiny limit returns the
  // newest notes — and would NOT include the old soon-expiring one, which is
  // exactly why post-filtering that window dropped every expiring note.
  const recent = listNotes({ limit: 2 });
  expect(recent.map((n) => n.id)).not.toContain(soon.id);
});

test("expiring results are ordered soonest-first", async () => {
  const { init } = await import("../src/cli/commands/init");
  const { createNote, listNotes } = await import("../src/core/storage");
  expect(await init()).toBe(0);

  const a = await createNote({ type: "snippet", title: "A", body_html: "<p>x</p>", thread_id: "t" });
  const b = await createNote({ type: "snippet", title: "B", body_html: "<p>x</p>", thread_id: "t" });
  db().run("UPDATE notes SET expires_at = ? WHERE id = ?", [daysFromNow(5), a.id]);
  db().run("UPDATE notes SET expires_at = ? WHERE id = ?", [daysFromNow(1), b.id]);

  const ids = listNotes({ expiring: true }).map((n) => n.id);
  expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id)); // b (1d) before a (5d)
});
