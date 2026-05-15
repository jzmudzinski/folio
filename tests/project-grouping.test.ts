/**
 * Project grouping (v0.20+).
 *
 *   ✓ listProjectThreads returns empty groups + zero totalNotes when no
 *     notes carry the tag
 *   ✓ Groups notes by thread_id, counts correctly per thread
 *   ✓ Includes finalCount per group, totalCount aggregation
 *   ✓ Threads sorted by latest-created descending
 *   ✓ Notes not tagged with project:<slug> don't leak in
 *   ✓ GET /p/:slug renders the project page; cards present
 *   ✓ GET /p/:slug empty state when no notes
 *   ✓ GET /api/p/:slug returns JSON shape
 */

import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDb } from "../src/core/db";

let homeDir: string;
let viewer: { stop: () => void; port: number; hostname: string } | null = null;
let viewerUrl = "";

async function bootViewer(): Promise<void> {
  const { init } = await import("../src/cli/commands/init");
  await init();
  const cfgPath = join(homeDir, "folio.config.json");
  const parsed = JSON.parse(readFileSync(cfgPath, "utf-8"));
  parsed.viewer_port = 0;
  writeFileSync(cfgPath, JSON.stringify(parsed));
  const { startServer } = await import("../src/viewer/server");
  viewer = (await startServer()) as any;
  viewerUrl = `http://${viewer!.hostname}:${viewer!.port}`;
}

beforeEach(async () => {
  homeDir = mkdtempSync(join(tmpdir(), "folio-proj-"));
  process.env.FOLIO_HOME = homeDir;
});

afterEach(() => {
  try { viewer?.stop(); } catch {}
  viewer = null;
  closeDb();
  rmSync(homeDir, { recursive: true, force: true });
  delete process.env.FOLIO_HOME;
});

async function seedNote(opts: {
  title: string;
  thread: string;
  tags: string[];
  is_final?: boolean;
  type?: "research" | "snippet" | "comparison" | "technical" | "journal";
}): Promise<string> {
  const { init } = await import("../src/cli/commands/init");
  await init();
  const { createNote } = await import("../src/core/storage");
  const note = await createNote({
    type: opts.type ?? "research",
    title: opts.title,
    body_html: "<p>seed</p>",
    thread_id: opts.thread,
    theme: "linen",
    tags: opts.tags,
    is_final: opts.is_final ?? false,
  });
  return note.id;
}

// ───── storage helper ─────────────────────────────────────────────────

test("listProjectThreads returns empty when no notes carry the project tag", async () => {
  const { init } = await import("../src/cli/commands/init");
  await init();
  const { listProjectThreads } = await import("../src/core/storage");
  const r = listProjectThreads("nonexistent");
  expect(r.groups).toEqual([]);
  expect(r.totalNotes).toBe(0);
});

test("groups notes by thread_id; counts + finalCount per thread; totalNotes aggregates", async () => {
  await seedNote({ title: "Research A1", thread: "research", tags: ["project:repcoach"] });
  await seedNote({ title: "Research A2", thread: "research", tags: ["project:repcoach"], is_final: true });
  await seedNote({ title: "Onboarding v1", thread: "onboarding", tags: ["project:repcoach"] });
  // Different project — should not leak in.
  await seedNote({ title: "Other proj", thread: "research", tags: ["project:other"] });
  // No project tag — should not leak in.
  await seedNote({ title: "Untagged", thread: "research", tags: [] });

  const { listProjectThreads } = await import("../src/core/storage");
  const r = listProjectThreads("repcoach");

  expect(r.totalNotes).toBe(3);
  expect(r.groups).toHaveLength(2);
  const research = r.groups.find((g) => g.thread_id === "research")!;
  const onboarding = r.groups.find((g) => g.thread_id === "onboarding")!;
  expect(research.noteCount).toBe(2);
  expect(research.finalCount).toBe(1);
  expect(onboarding.noteCount).toBe(1);
  expect(onboarding.finalCount).toBe(0);
});

test("threads sorted by latest activity (descending)", async () => {
  await seedNote({ title: "Old", thread: "old-thread", tags: ["project:p"] });
  // Force a small delay so created timestamps differ.
  await new Promise((r) => setTimeout(r, 20));
  await seedNote({ title: "New", thread: "new-thread", tags: ["project:p"] });

  const { listProjectThreads } = await import("../src/core/storage");
  const r = listProjectThreads("p");
  expect(r.groups[0]!.thread_id).toBe("new-thread");
  expect(r.groups[1]!.thread_id).toBe("old-thread");
});

// ───── viewer routes ──────────────────────────────────────────────────

test("GET /p/:slug renders cards for each thread in the project", async () => {
  await bootViewer();
  await seedNote({ title: "Repcoach research v1", thread: "research", tags: ["project:repcoach"] });
  await seedNote({ title: "Onboarding flow", thread: "onboarding", tags: ["project:repcoach"], type: "technical" });

  const r = await fetch(`${viewerUrl}/p/repcoach`);
  expect(r.status).toBe(200);
  const html = await r.text();
  expect(html).toContain("Project: repcoach");
  // Both thread cards present.
  expect(html).toContain('href="/t/research"');
  expect(html).toContain('href="/t/onboarding"');
  // Latest note titles surface.
  expect(html).toContain("Repcoach research v1");
  expect(html).toContain("Onboarding flow");
});

test("GET /p/:slug shows empty state when no notes carry the tag", async () => {
  await bootViewer();
  const r = await fetch(`${viewerUrl}/p/nothing-here`);
  expect(r.status).toBe(200);
  const html = await r.text();
  expect(html).toContain("No threads tagged");
  expect(html).toContain("project:nothing-here");
});

test("GET /api/p/:slug returns JSON groups + totalNotes", async () => {
  await bootViewer();
  await seedNote({ title: "x", thread: "th1", tags: ["project:json-test"] });
  await seedNote({ title: "y", thread: "th2", tags: ["project:json-test"] });

  const r = await fetch(`${viewerUrl}/api/p/json-test`);
  expect(r.status).toBe(200);
  const data = await r.json() as any;
  expect(data.totalNotes).toBe(2);
  expect(data.groups).toHaveLength(2);
  expect(data.groups[0].thread_id).toBeDefined();
  expect(data.groups[0].noteCount).toBe(1);
});

test("GET /api/p/ (empty slug) returns 400", async () => {
  await bootViewer();
  const r = await fetch(`${viewerUrl}/api/p/`);
  expect(r.status).toBe(400);
});
