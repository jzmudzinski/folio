/**
 * v0.23 — Continue-rail scoring + view-tracking + viewer integration.
 *
 * Three surfaces:
 *   - listContinueRail() in src/core/storage.ts
 *   - logNoteView() debounce
 *   - pageList rendering + /api/notes route emitting note_viewed
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
  tmpDir = mkdtempSync(join(tmpdir(), "folio-rail-"));
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

// ─── Scoring ────────────────────────────────────────────────────────────

test("listContinueRail returns empty when there are no events", async () => {
  await setup();
  const { listContinueRail } = await import("../src/core/storage");
  expect(listContinueRail()).toEqual([]);
});

test("listContinueRail ranks threads by recency × frequency (more recent + more touches wins)", async () => {
  await setup();
  const { createNote, listContinueRail } = await import("../src/core/storage");
  // Thread A: 3 notes created today
  for (let i = 0; i < 3; i++) {
    await createNote({
      type: "research", title: `A note ${i}`, body_html: "<p>x</p>",
      thread_id: "thread-a", theme: "linen", tags: [],
    });
  }
  // Thread B: 1 note created today
  await createNote({
    type: "research", title: "B note", body_html: "<p>x</p>",
    thread_id: "thread-b", theme: "linen", tags: [],
  });
  const rail = listContinueRail();
  expect(rail.length).toBe(2);
  expect(rail[0]!.thread_id).toBe("thread-a"); // more touches → higher score
  expect(rail[0]!.touch_count).toBeGreaterThanOrEqual(rail[1]!.touch_count);
  expect(rail[0]!.score).toBeGreaterThan(rail[1]!.score);
});

test("listContinueRail honors limit and never exceeds it", async () => {
  await setup();
  const { createNote, listContinueRail } = await import("../src/core/storage");
  for (let i = 0; i < 8; i++) {
    await createNote({
      type: "snippet", title: `note ${i}`, body_html: "<p>x</p>",
      thread_id: `t-${i}`, theme: "linen", tags: [],
    });
  }
  expect(listContinueRail({ limit: 3 }).length).toBe(3);
  expect(listContinueRail({ limit: 5 }).length).toBe(5);
});

test("listContinueRail extracts project_slug from project:<slug> tag", async () => {
  await setup();
  const { createNote, listContinueRail } = await import("../src/core/storage");
  await createNote({
    type: "research", title: "Notibox onboarding", body_html: "<p>x</p>",
    thread_id: "notibox-onboarding", theme: "linen",
    tags: ["project:notibox-jetson", "research"],
  });
  await createNote({
    type: "snippet", title: "Loose snippet", body_html: "<p>x</p>",
    thread_id: "loose", theme: "linen", tags: [],
  });
  const rail = listContinueRail();
  const notibox = rail.find((r) => r.thread_id === "notibox-onboarding");
  const loose = rail.find((r) => r.thread_id === "loose");
  expect(notibox?.project_slug).toBe("notibox-jetson");
  expect(loose?.project_slug).toBeNull();
});

test("listContinueRail flags pending iteration threads (non-finalized iteration note present)", async () => {
  await setup();
  const { createNote, listContinueRail, finalize } = await import("../src/core/storage");
  await createNote({
    type: "iteration", title: "Logo design", body_html: "<p>chrome</p>",
    thread_id: "logo", theme: "linen", tags: [],
  });
  await createNote({
    type: "research", title: "Plain research", body_html: "<p>x</p>",
    thread_id: "plain", theme: "linen", tags: [],
  });
  const rail = listContinueRail();
  const logo = rail.find((r) => r.thread_id === "logo");
  const plain = rail.find((r) => r.thread_id === "plain");
  expect(logo?.has_pending_iteration).toBe(true);
  expect(logo?.pending_iteration_id).toBeTruthy();
  expect(plain?.has_pending_iteration).toBe(false);

  // After finalize: pending flag clears
  finalize(logo!.pending_iteration_id!);
  const railAfter = listContinueRail();
  const logoAfter = railAfter.find((r) => r.thread_id === "logo");
  expect(logoAfter?.has_pending_iteration).toBe(false);
});

test("listContinueRail excludes superseded threads from results", async () => {
  await setup();
  const { createNote, replaceNote, listContinueRail } = await import("../src/core/storage");
  const v1 = await createNote({
    type: "snippet", title: "A note", body_html: "<p>x</p>",
    thread_id: "a", theme: "linen", tags: [],
  });
  // v1's events stay in the events table, but if we supersede it AND it's
  // the only note in the thread, the EXISTS clause should still find a
  // head note (the new one) → thread A remains. Test that.
  await replaceNote({ old_id: v1.id, body_html: "<p>v2</p>", title: "A note v2" });
  const rail = listContinueRail();
  const a = rail.find((r) => r.thread_id === "a");
  expect(a).toBeDefined(); // head still exists, score includes the create event
  // The latest title resolves to the new head, not the superseded old version.
  expect(a?.title).toBe("A note v2");
});

test("listContinueRail latest_note_id always points at the head (non-superseded) note", async () => {
  await setup();
  const { createNote, replaceNote, listContinueRail } = await import("../src/core/storage");
  const v1 = await createNote({
    type: "snippet", title: "Original", body_html: "<p>v1</p>",
    thread_id: "evo", theme: "linen", tags: [],
  });
  const r = await replaceNote({ old_id: v1.id, body_html: "<p>v2 body</p>", title: "Replaced" });
  const rail = listContinueRail();
  const evo = rail.find((r2) => r2.thread_id === "evo");
  expect(evo?.latest_note_id).toBe(r.new_meta!.id);
  expect(evo?.title).toBe("Replaced");
});

test("listContinueRail decays older events — old touches contribute less than fresh ones", async () => {
  await setup();
  const { createNote, listContinueRail } = await import("../src/core/storage");
  const { db } = await import("../src/core/db");
  // Thread "old": 1 event from 5 days ago (we'll fake the ts directly)
  await createNote({
    type: "snippet", title: "old", body_html: "<p>x</p>",
    thread_id: "old", theme: "linen", tags: [],
  });
  db().run(
    "UPDATE events SET ts = datetime('now', '-5 days') WHERE thread_id = 'old'",
  );
  // Thread "fresh": 1 event today (default)
  await createNote({
    type: "snippet", title: "fresh", body_html: "<p>x</p>",
    thread_id: "fresh", theme: "linen", tags: [],
  });
  const rail = listContinueRail();
  const fresh = rail.find((r) => r.thread_id === "fresh");
  const old = rail.find((r) => r.thread_id === "old");
  expect(fresh!.score).toBeGreaterThan(old!.score);
});

// ─── note_viewed debounce ───────────────────────────────────────────────

test("logNoteView debounces — second call within 30 min does NOT log a duplicate event", async () => {
  await setup();
  const { createNote, logNoteView } = await import("../src/core/storage");
  const { db } = await import("../src/core/db");
  const note = await createNote({
    type: "snippet", title: "x", body_html: "<p>x</p>",
    thread_id: "vw", theme: "linen", tags: [],
  });
  logNoteView(note.id, note.thread_id);
  logNoteView(note.id, note.thread_id);
  logNoteView(note.id, note.thread_id);
  const count = db()
    .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM events WHERE kind = 'note_viewed'")
    .get()!.n;
  expect(count).toBe(1);
});

test("logNoteView re-logs once the 30-min debounce window expires (event ts rewritten)", async () => {
  await setup();
  const { createNote, logNoteView } = await import("../src/core/storage");
  const { db } = await import("../src/core/db");
  const note = await createNote({
    type: "snippet", title: "x", body_html: "<p>x</p>",
    thread_id: "vw", theme: "linen", tags: [],
  });
  logNoteView(note.id, note.thread_id);
  // Backdate the existing view event past the 30-min window
  db().run(
    "UPDATE events SET ts = datetime('now', '-31 minutes') WHERE kind = 'note_viewed' AND note_id = ?",
    [note.id],
  );
  logNoteView(note.id, note.thread_id);
  const count = db()
    .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM events WHERE kind = 'note_viewed'")
    .get()!.n;
  expect(count).toBe(2);
});

// ─── Viewer integration ────────────────────────────────────────────────

test("GET / renders the continue-rail above the notes list when rail items exist", async () => {
  await setup();
  const { createNote } = await import("../src/core/storage");
  await createNote({
    type: "research", title: "Active research", body_html: "<p>x</p>",
    thread_id: "active", theme: "linen", tags: ["project:notibox"],
  });
  await startViewer();
  const r = await fetch(`${viewerUrl}/`);
  const html = await r.text();
  expect(html).toContain('class="v-rail"');
  expect(html).toContain("Continue where you left off");
  expect(html).toContain("project:notibox");
});

test("GET / with a filter (?type=research) does NOT render the continue-rail", async () => {
  await setup();
  const { createNote } = await import("../src/core/storage");
  await createNote({
    type: "research", title: "x", body_html: "<p>x</p>",
    thread_id: "t1", theme: "linen", tags: [],
  });
  await startViewer();
  const r = await fetch(`${viewerUrl}/?type=research`);
  const html = await r.text();
  expect(html).not.toContain('class="v-rail"');
});

test("GET / on an empty database renders no rail (zero items)", async () => {
  await setup();
  await startViewer();
  const r = await fetch(`${viewerUrl}/`);
  const html = await r.text();
  expect(html).not.toContain('class="v-rail"');
});

test("Rail card links to /n/<pending-iteration-id> when thread has a pending iteration", async () => {
  await setup();
  const { createNote } = await import("../src/core/storage");
  const iter = await createNote({
    type: "iteration", title: "Logo design", body_html: "<p>chrome</p>",
    thread_id: "logo", theme: "linen", tags: [],
  });
  await startViewer();
  const r = await fetch(`${viewerUrl}/`);
  const html = await r.text();
  expect(html).toContain(`href="/n/${iter.id}"`);
  expect(html).toContain("iteration · pending pick");
});

test("Rail card links to /p/<slug> when project tag present (and no pending iteration)", async () => {
  await setup();
  const { createNote } = await import("../src/core/storage");
  await createNote({
    type: "research", title: "Notibox", body_html: "<p>x</p>",
    thread_id: "notibox", theme: "linen", tags: ["project:notibox-jetson"],
  });
  await startViewer();
  const r = await fetch(`${viewerUrl}/`);
  const html = await r.text();
  expect(html).toContain('href="/p/notibox-jetson"');
});

test("Rail card links to /n/<latest> when no project tag and no pending iteration", async () => {
  await setup();
  const { createNote } = await import("../src/core/storage");
  const note = await createNote({
    type: "snippet", title: "loose", body_html: "<p>x</p>",
    thread_id: "loose", theme: "linen", tags: [],
  });
  await startViewer();
  const r = await fetch(`${viewerUrl}/`);
  const html = await r.text();
  expect(html).toContain(`href="/n/${note.id}"`);
});

test("Visiting /n/:id from the viewer triggers note_viewed event for rail scoring", async () => {
  await setup();
  const { createNote } = await import("../src/core/storage");
  const { db } = await import("../src/core/db");
  const note = await createNote({
    type: "snippet", title: "x", body_html: "<p>x</p>",
    thread_id: "tv", theme: "linen", tags: [],
  });
  await startViewer();
  // No view yet
  expect(
    db().query<{ n: number }, []>("SELECT COUNT(*) AS n FROM events WHERE kind = 'note_viewed'").get()!.n,
  ).toBe(0);
  await fetch(`${viewerUrl}/n/${note.id}`);
  expect(
    db().query<{ n: number }, []>("SELECT COUNT(*) AS n FROM events WHERE kind = 'note_viewed'").get()!.n,
  ).toBe(1);
  // Second hit is debounced
  await fetch(`${viewerUrl}/n/${note.id}`);
  expect(
    db().query<{ n: number }, []>("SELECT COUNT(*) AS n FROM events WHERE kind = 'note_viewed'").get()!.n,
  ).toBe(1);
});
