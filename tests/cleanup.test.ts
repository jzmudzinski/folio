import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDb, db } from "../src/core/db";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "folio-cleanup-test-"));
  process.env.FOLIO_HOME = tmpDir;
  const { init } = await import("../src/cli/commands/init");
  await init();
});

afterEach(() => {
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
});

test("cleanup moves expired non-final notes to .trash and skips final", async () => {
  const { createNote, cleanup } = await import("../src/core/storage");

  const nonFinal = await createNote({ type: "snippet", title: "old non-final", body_html: "<p>x</p>" });
  const finalNote = await createNote({ type: "snippet", title: "final stays", body_html: "<p>y</p>", is_final: true });

  // Backdate the non-final note past expiry
  db().run("UPDATE notes SET expires_at = datetime('now', '-1 day') WHERE id = ?", [nonFinal.id]);

  const r = await cleanup({ dry_run: false });
  expect(r.trashed.length).toBe(1);
  expect(r.trashed[0]!.id).toBe(nonFinal.id);
  expect(r.dry_run).toBe(false);

  // Original file moved
  expect(existsSync(join(tmpDir, nonFinal.path))).toBe(false);
  expect(existsSync(join(tmpDir, ".trash", nonFinal.id, "note.html"))).toBe(true);

  // Final note untouched
  expect(existsSync(join(tmpDir, finalNote.path))).toBe(true);

  // DB status updated
  const row = db().query<{ status: string }, [string]>("SELECT status FROM notes WHERE id = ?").get(nonFinal.id);
  expect(row?.status).toBe("trashed");
});

test("dry-run reports but does not modify filesystem or DB", async () => {
  const { createNote, cleanup } = await import("../src/core/storage");

  const n = await createNote({ type: "snippet", title: "old", body_html: "<p>x</p>" });
  db().run("UPDATE notes SET expires_at = datetime('now', '-1 day') WHERE id = ?", [n.id]);

  const r = await cleanup({ dry_run: true });
  expect(r.trashed.length).toBe(1);
  expect(r.dry_run).toBe(true);

  // File still exists
  expect(existsSync(join(tmpDir, n.path))).toBe(true);
  // DB status unchanged
  const row = db().query<{ status: string }, [string]>("SELECT status FROM notes WHERE id = ?").get(n.id);
  expect(row?.status).toBe("active");
});

test("phase 2: notes in trash past grace are hard deleted from DB + filesystem", async () => {
  const { createNote, cleanup } = await import("../src/core/storage");

  const n = await createNote({ type: "snippet", title: "doomed", body_html: "<p>x</p>" });
  db().run("UPDATE notes SET expires_at = datetime('now', '-1 day') WHERE id = ?", [n.id]);

  // Phase 1: move to trash
  await cleanup({ dry_run: false });

  // Simulate that it's been in trash for 8 days
  db().run("UPDATE notes SET updated = datetime('now', '-8 days') WHERE id = ?", [n.id]);

  const r = await cleanup({ dry_run: false, trash_grace_days: 7 });
  expect(r.hard_deleted.length).toBe(1);
  expect(r.hard_deleted[0]!.id).toBe(n.id);

  // Gone from DB
  const exists = db().query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM notes WHERE id = ?").get(n.id);
  expect(exists?.n).toBe(0);
  // Gone from filesystem trash
  expect(existsSync(join(tmpDir, ".trash", n.id))).toBe(false);
});
