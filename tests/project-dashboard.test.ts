/**
 * v0.24 — getProjectDashboard() + rich pageProject() integration.
 *
 * Coverage:
 *   - slot detection (one head per slot)
 *   - slot ordering (STANDARD_SLOTS first, alpha after)
 *   - slot collision warning (>1 candidate per slot)
 *   - excerpt extraction from on-disk HTML
 *   - pending iterations filter (non-finalized iteration notes in project)
 *   - recent activity scoped to project threads with day-window cap
 *   - viewer sections render slot cards / pending / activity / threads
 *   - empty project state unchanged
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
  tmpDir = mkdtempSync(join(tmpdir(), "folio-proj-dash-"));
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

// ─── slot detection ────────────────────────────────────────────────────

test("getProjectDashboard returns empty slots/pending/activity for an empty project", async () => {
  await setup();
  const { getProjectDashboard } = await import("../src/core/storage");
  const d = getProjectDashboard("nonexistent");
  expect(d.slots).toEqual([]);
  expect(d.pendingIterations).toEqual([]);
  expect(d.recentActivity).toEqual([]);
  expect(d.threadGroups).toEqual([]);
  expect(d.totalNotes).toBe(0);
});

test("getProjectDashboard surfaces slot:<name> notes as canonical docs", async () => {
  await setup();
  const { createNote, getProjectDashboard } = await import("../src/core/storage");
  await createNote({
    type: "technical", title: "Roadmap", body_html: "<p class=\"lead\">Where we're going.</p><p>Quarter 1: foundations. Quarter 2: scale.</p>",
    thread_id: "roadmap", theme: "linen",
    tags: ["project:demo", "slot:roadmap"],
  });
  await createNote({
    type: "snippet", title: "Todo list", body_html: "<p>Open items below.</p>",
    thread_id: "todo", theme: "linen",
    tags: ["project:demo", "slot:todo"],
    live: true,
  });
  await createNote({
    type: "research", title: "Just research, no slot", body_html: "<p>x</p>",
    thread_id: "research", theme: "linen",
    tags: ["project:demo"],
  });
  const d = getProjectDashboard("demo");
  expect(d.slots.length).toBe(2);
  const names = d.slots.map((s) => s.name);
  // STANDARD_SLOTS order: roadmap before todo
  expect(names).toEqual(["roadmap", "todo"]);
  const roadmap = d.slots[0]!;
  expect(roadmap.head.title).toBe("Roadmap");
  expect(roadmap.excerpt).toContain("Where we're going");
  expect(roadmap.duplicates).toBe(0);
});

test("getProjectDashboard places non-standard slots after standard ones, alpha", async () => {
  await setup();
  const { createNote, getProjectDashboard } = await import("../src/core/storage");
  // Custom slot names interleaved with one standard
  await createNote({
    type: "technical", title: "z-custom", body_html: "<p>x</p>",
    thread_id: "z", theme: "linen", tags: ["project:demo", "slot:zeta"],
  });
  await createNote({
    type: "technical", title: "a-custom", body_html: "<p>x</p>",
    thread_id: "a", theme: "linen", tags: ["project:demo", "slot:alpha"],
  });
  await createNote({
    type: "technical", title: "todo-std", body_html: "<p>x</p>",
    thread_id: "t", theme: "linen", tags: ["project:demo", "slot:todo"],
  });
  const d = getProjectDashboard("demo");
  const names = d.slots.map((s) => s.name);
  expect(names).toEqual(["todo", "alpha", "zeta"]); // standard "todo" first, then alpha-sorted unknowns
});

test("getProjectDashboard reports duplicate slot warnings + picks most-recently-updated head", async () => {
  await setup();
  const { createNote, getProjectDashboard, updateNoteMetadata } = await import("../src/core/storage");
  const first = await createNote({
    type: "technical", title: "Roadmap v1", body_html: "<p>v1</p>",
    thread_id: "r1", theme: "linen", tags: ["project:demo", "slot:roadmap"],
  });
  await new Promise((r) => setTimeout(r, 12));
  const second = await createNote({
    type: "technical", title: "Roadmap v2", body_html: "<p>v2</p>",
    thread_id: "r2", theme: "linen", tags: ["project:demo", "slot:roadmap"],
  });
  // Touch the "first" so updated timestamps tie; head should be the newer
  // updated, falling back to created.
  let d = getProjectDashboard("demo");
  expect(d.slots.length).toBe(1);
  expect(d.slots[0]!.name).toBe("roadmap");
  expect(d.slots[0]!.head.id).toBe(second.id);
  expect(d.slots[0]!.duplicates).toBe(1);
  expect(d.slotWarnings).toEqual([{ slot: "roadmap", count: 1 }]);

  // Now bump the first via metadata update — it should become the head.
  await new Promise((r) => setTimeout(r, 12));
  await updateNoteMetadata({ id: first.id, title: "Roadmap v1 bumped" });
  d = getProjectDashboard("demo");
  expect(d.slots[0]!.head.id).toBe(first.id);
});

test("getProjectDashboard slot excerpts strip HTML and cap at 280 chars", async () => {
  await setup();
  const { createNote, getProjectDashboard } = await import("../src/core/storage");
  const longBody = "<h3>Heading</h3><p>" + "Lorem ipsum dolor sit amet. ".repeat(40) + "</p>";
  await createNote({
    type: "technical", title: "Long doc", body_html: longBody,
    thread_id: "long", theme: "linen", tags: ["project:demo", "slot:vision"],
  });
  const d = getProjectDashboard("demo");
  expect(d.slots[0]!.excerpt.length).toBeLessThan(290);
  expect(d.slots[0]!.excerpt).toContain("Heading");
  expect(d.slots[0]!.excerpt).toContain("Lorem ipsum");
  // No tag fragments
  expect(d.slots[0]!.excerpt).not.toContain("<");
});

test("getProjectDashboard skips superseded notes when picking slot heads", async () => {
  await setup();
  const { createNote, replaceNote, getProjectDashboard } = await import("../src/core/storage");
  const v1 = await createNote({
    type: "technical", title: "Roadmap v1", body_html: "<p>v1 body</p>",
    thread_id: "r", theme: "linen", tags: ["project:demo", "slot:roadmap"],
  });
  const replaced = await replaceNote({ old_id: v1.id, body_html: "<p>v2 body</p>", title: "Roadmap v2" });
  expect(replaced.ok).toBe(true);
  const d = getProjectDashboard("demo");
  expect(d.slots.length).toBe(1);
  expect(d.slots[0]!.head.id).toBe(replaced.new_meta!.id);
  expect(d.slots[0]!.duplicates).toBe(0); // superseded v1 isn't a duplicate
});

// ─── pending iterations ────────────────────────────────────────────────

test("getProjectDashboard surfaces non-finalized iteration notes as pending", async () => {
  await setup();
  const { createNote, getProjectDashboard, finalize } = await import("../src/core/storage");
  const iter = await createNote({
    type: "iteration", title: "Logo design", body_html: "<p>chrome</p>",
    thread_id: "logo", theme: "linen", tags: ["project:demo"],
  });
  await createNote({
    type: "iteration", title: "Done logo round", body_html: "<p>chrome</p>",
    thread_id: "done-logo", theme: "linen", tags: ["project:demo"],
  });
  // Finalize the second iteration → it's no longer pending
  const all = (await import("../src/core/storage")).listNotes({ type: "iteration", thread_id: "done-logo" });
  finalize(all[0]!.id);

  const d = getProjectDashboard("demo");
  expect(d.pendingIterations.length).toBe(1);
  expect(d.pendingIterations[0]!.id).toBe(iter.id);
});

// ─── recent activity ───────────────────────────────────────────────────

test("getProjectDashboard recent activity is scoped to project threads only", async () => {
  await setup();
  const { createNote, getProjectDashboard } = await import("../src/core/storage");
  await createNote({
    type: "research", title: "in project", body_html: "<p>x</p>",
    thread_id: "inproj", theme: "linen", tags: ["project:demo"],
  });
  await createNote({
    type: "research", title: "outside project", body_html: "<p>x</p>",
    thread_id: "outside", theme: "linen", tags: [],
  });
  const d = getProjectDashboard("demo");
  expect(d.recentActivity.length).toBeGreaterThan(0);
  for (const e of d.recentActivity) {
    expect(e.thread_id).toBe("inproj");
  }
});

test("getProjectDashboard respects activityLimit", async () => {
  await setup();
  const { createNote, getProjectDashboard } = await import("../src/core/storage");
  for (let i = 0; i < 7; i++) {
    await createNote({
      type: "snippet", title: `note ${i}`, body_html: "<p>x</p>",
      thread_id: `t${i}`, theme: "linen", tags: ["project:demo"],
    });
  }
  const d = getProjectDashboard("demo", { activityLimit: 3 });
  expect(d.recentActivity.length).toBe(3);
});

// ─── viewer integration ───────────────────────────────────────────────

test("GET /p/<slug> renders slot cards above the threads list", async () => {
  await setup();
  const { createNote } = await import("../src/core/storage");
  await createNote({
    type: "technical", title: "NotiBox roadmap", body_html: "<p>Where we're going next quarter.</p>",
    thread_id: "roadmap", theme: "linen", tags: ["project:notibox", "slot:roadmap"],
  });
  await createNote({
    type: "snippet", title: "Plain note", body_html: "<p>not slot-tagged</p>",
    thread_id: "plain", theme: "linen", tags: ["project:notibox"],
  });
  await startViewer();
  const r = await fetch(`${viewerUrl}/p/notibox`);
  const html = await r.text();
  expect(html).toContain("Canonical docs");
  expect(html).toContain('class="proj-slot"');
  expect(html).toContain("slot:roadmap");
  expect(html).toContain("NotiBox roadmap");
  expect(html).toContain("Where we're going");
});

test("GET /p/<slug> renders pending-iteration cards when iteration notes await pick", async () => {
  await setup();
  const { createNote } = await import("../src/core/storage");
  await createNote({
    type: "iteration", title: "Hero variants", body_html: "<p>chrome</p>",
    thread_id: "hero", theme: "linen", tags: ["project:demo"],
  });
  await startViewer();
  const r = await fetch(`${viewerUrl}/p/demo`);
  const html = await r.text();
  expect(html).toContain("Pending picks");
  expect(html).toContain('class="proj-pending-card"');
  expect(html).toContain("Hero variants");
});

test("GET /p/<slug> renders activity timeline section", async () => {
  await setup();
  const { createNote } = await import("../src/core/storage");
  await createNote({
    type: "research", title: "Recent", body_html: "<p>x</p>",
    thread_id: "rt", theme: "linen", tags: ["project:demo"],
  });
  await startViewer();
  const r = await fetch(`${viewerUrl}/p/demo`);
  const html = await r.text();
  expect(html).toContain("Recent activity");
  expect(html).toContain('class="proj-activity"');
  expect(html).toContain('class="proj-act-row"');
});

test("GET /p/<slug> for empty project still renders the helpful 'tag a note' prompt", async () => {
  await setup();
  await startViewer();
  const r = await fetch(`${viewerUrl}/p/nothing-here`);
  const html = await r.text();
  expect(r.status).toBe(200);
  expect(html).toContain("No threads tagged");
  expect(html).toContain("project:nothing-here");
  // No slot / pending / activity sections shown when empty
  expect(html).not.toContain("Canonical docs");
  expect(html).not.toContain("Pending picks");
});

test("GET /p/<slug> renders duplicate-slot warnings on the offending card", async () => {
  await setup();
  const { createNote } = await import("../src/core/storage");
  await createNote({
    type: "technical", title: "Roadmap A", body_html: "<p>a</p>",
    thread_id: "ra", theme: "linen", tags: ["project:demo", "slot:roadmap"],
  });
  await createNote({
    type: "technical", title: "Roadmap B", body_html: "<p>b</p>",
    thread_id: "rb", theme: "linen", tags: ["project:demo", "slot:roadmap"],
  });
  await startViewer();
  const r = await fetch(`${viewerUrl}/p/demo`);
  const html = await r.text();
  expect(html).toContain("proj-slot__warn");
  expect(html).toContain("+1 dupe");
});
