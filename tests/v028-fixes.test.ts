/**
 * v0.28 — three UX fixes verified end-to-end:
 *   1. feed/changelog DESC sort within pinned + non-pinned sections
 *   2. continue rail cap=4 + project tile dedup
 *   3. popular tags promoted to header bar, namespaced-first ordering
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
  tmpDir = mkdtempSync(join(tmpdir(), "folio-v028-"));
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

// ─── Fix 1: feed DESC sort ─────────────────────────────────────────────

test("renderFeedHtml reverses entries within each section so newest renders first", async () => {
  const { renderFeedHtml } = await import("../src/core/feed-render");
  const compiled = [
    { id: "a", ts: "2026-05-01T00:00:00Z", content_html: "<p>first</p>", tags: [], compiled_tags: [], pinned: false, rendered: true },
    { id: "b", ts: "2026-05-02T00:00:00Z", content_html: "<p>middle</p>", tags: [], compiled_tags: [], pinned: false, rendered: true },
    { id: "c", ts: "2026-05-03T00:00:00Z", content_html: "<p>newest</p>", tags: [], compiled_tags: [], pinned: false, rendered: true },
  ] as any[];
  const html = renderFeedHtml(compiled);
  const idxFirst = html.indexOf("first");
  const idxMiddle = html.indexOf("middle");
  const idxNewest = html.indexOf("newest");
  // Newest entry's HTML must appear BEFORE the older ones in source order
  expect(idxNewest).toBeLessThan(idxMiddle);
  expect(idxMiddle).toBeLessThan(idxFirst);
});

test("renderFeedHtml puts pinned section first; within pinned + within rest both are DESC", async () => {
  const { renderFeedHtml } = await import("../src/core/feed-render");
  const compiled = [
    { id: "p1-old", ts: "2026-05-01T00:00:00Z", content_html: "<p>p1</p>", tags: [], compiled_tags: [], pinned: true, rendered: true },
    { id: "r1-old", ts: "2026-05-02T00:00:00Z", content_html: "<p>r1</p>", tags: [], compiled_tags: [], pinned: false, rendered: true },
    { id: "p2-new", ts: "2026-05-03T00:00:00Z", content_html: "<p>p2</p>", tags: [], compiled_tags: [], pinned: true, rendered: true },
    { id: "r2-new", ts: "2026-05-04T00:00:00Z", content_html: "<p>r2</p>", tags: [], compiled_tags: [], pinned: false, rendered: true },
  ] as any[];
  const html = renderFeedHtml(compiled);
  // Pinned section appears before non-pinned
  const pinnedSection = html.indexOf('entries-pinned');
  const restSection = html.indexOf('entries-feed');
  expect(pinnedSection).toBeGreaterThan(-1);
  expect(restSection).toBeGreaterThan(-1);
  expect(pinnedSection).toBeLessThan(restSection);
  // Within pinned: newer (p2) before older (p1)
  expect(html.indexOf("p2")).toBeLessThan(html.indexOf("p1"));
  // Within rest: newer (r2) before older (r1)
  expect(html.indexOf("r2")).toBeLessThan(html.indexOf("r1"));
});

test("PANEL_RENDER_JS reverses entries before rendering (white-box check)", async () => {
  const { panelIframeSrcdoc } = await import("../src/viewer/live-panel");
  const html = panelIframeSrcdoc({ theme_css: "", entries_css: "", noteId: "n" });
  // Sentinel from the v0.28 reverse logic
  expect(html).toContain(".slice().reverse()");
});

test("INLINE_FEED_BOOTSTRAP_JS prepends new entries (newest first per section)", async () => {
  const { INLINE_FEED_BOOTSTRAP_JS } = await import("../src/core/feed-render");
  // Sentinel from the v0.28 prepend logic
  expect(INLINE_FEED_BOOTSTRAP_JS).toContain("firstPinned");
  expect(INLINE_FEED_BOOTSTRAP_JS).toContain("firstFeed");
  expect(INLINE_FEED_BOOTSTRAP_JS).toContain("insertBefore(el, firstPinned)");
});

// ─── Fix 2: continue rail dedup + cap=4 ────────────────────────────────

test("listContinueRail collapses same-project threads into one project tile", async () => {
  await setup();
  const { createNote, listContinueRail } = await import("../src/core/storage");
  for (const tid of ["a", "b", "c", "d"]) {
    await createNote({
      type: "research", title: `n ${tid}`, body_html: "<p>x</p>",
      thread_id: tid, theme: "linen", tags: ["project:big-project"],
    });
  }
  const rail = listContinueRail();
  const projTiles = rail.filter((r) => r.project_slug === "big-project");
  expect(projTiles.length).toBe(1);
  expect(projTiles[0]!.kind).toBe("project");
  expect(projTiles[0]!.member_thread_count).toBe(4);
});

test("listContinueRail aggregates touch_count + score across project members", async () => {
  await setup();
  const { createNote, listContinueRail } = await import("../src/core/storage");
  // Three threads, each generating 2 events (note_created + ?), all project:p
  for (const tid of ["t1", "t2", "t3"]) {
    await createNote({
      type: "snippet", title: tid, body_html: "<p>x</p>",
      thread_id: tid, theme: "linen", tags: ["project:p"],
    });
  }
  // Standalone thread for comparison
  await createNote({
    type: "snippet", title: "alone", body_html: "<p>x</p>",
    thread_id: "alone", theme: "linen", tags: [],
  });
  const rail = listContinueRail();
  const proj = rail.find((r) => r.project_slug === "p");
  const alone = rail.find((r) => r.thread_id === "alone" && r.kind === "thread");
  expect(proj?.touch_count).toBeGreaterThan(alone!.touch_count);
  expect(proj?.score).toBeGreaterThan(alone!.score);
});

test("GET / caps the continue rail at 4 cards", async () => {
  await setup();
  const { createNote } = await import("../src/core/storage");
  // 8 standalone threads — all distinct, no project tags → all "thread" tiles
  for (let i = 0; i < 8; i++) {
    await createNote({
      type: "snippet", title: `t${i}`, body_html: "<p>x</p>",
      thread_id: `t${i}`, theme: "linen", tags: [],
    });
  }
  await startViewer();
  const r = await fetch(`${viewerUrl}/`);
  const html = await r.text();
  // Each card carries class="v-rail-card" (possibly + modifiers); count
  // distinct openings.
  const matches = html.match(/<a [^>]*class="v-rail-card/g) ?? [];
  expect(matches.length).toBe(4);
});

test("Project tile renders with .is-project class and ▦ glyph; clicks to /p/<slug>", async () => {
  await setup();
  const { createNote } = await import("../src/core/storage");
  await createNote({
    type: "research", title: "x", body_html: "<p>x</p>",
    thread_id: "t1", theme: "linen", tags: ["project:demo"],
  });
  await createNote({
    type: "research", title: "y", body_html: "<p>y</p>",
    thread_id: "t2", theme: "linen", tags: ["project:demo"],
  });
  await startViewer();
  const r = await fetch(`${viewerUrl}/`);
  const html = await r.text();
  expect(html).toContain("is-project");
  expect(html).toContain('href="/p/demo"');
  // "project · N threads" badge in the proj label
  expect(html).toContain("project · 2 threads");
});

// ─── Fix 3: tags promoted to header bar ────────────────────────────────

test("GET / renders the .v-tagbar header strip with popular tags", async () => {
  await setup();
  const { createNote } = await import("../src/core/storage");
  // Each tag needs minCount>=2 to appear in listPopularTags(); create
  // two notes per tag.
  await createNote({ type: "snippet", title: "a", body_html: "<p>x</p>",
    thread_id: "t1", theme: "linen", tags: ["project:demo", "design"] });
  await createNote({ type: "snippet", title: "b", body_html: "<p>x</p>",
    thread_id: "t2", theme: "linen", tags: ["project:demo", "design"] });
  await startViewer();
  const r = await fetch(`${viewerUrl}/`);
  const html = await r.text();
  expect(html).toContain('class="v-tagbar"');
  expect(html).toContain('class="v-tagbar-lbl"');
  // Tag chips split namespace into spans: <span class="ns">project:</span><span class="val">demo</span>
  // The href carries the full URL-encoded tag.
  expect(html).toContain('href="/tag/project%3Ademo"');
  expect(html).toContain('href="/tag/design"');
  // Plain tag value appears as visible text
  expect(html).toMatch(/<span class="val">design<\/span>/);
  expect(html).toMatch(/<span class="val">demo<\/span>/);
});

test("Tags in header bar sort namespaced (with ':') first, then alphabetical", async () => {
  await setup();
  const { createNote } = await import("../src/core/storage");
  // Mix of namespaced + plain tags; each min 2 notes for popular threshold
  const tagSets = [
    ["zeta", "project:alpha"],          // 1 namespaced + 1 plain
    ["alpha", "slot:roadmap"],          // 1 namespaced + 1 plain
    ["beta", "kind:bug"],               // 1 namespaced + 1 plain
  ];
  for (let i = 0; i < tagSets.length; i++) {
    const tags = tagSets[i]!;
    for (let j = 0; j < 2; j++) {
      await createNote({
        type: "snippet", title: `${i}-${j}`, body_html: "<p>x</p>",
        thread_id: `t-${i}-${j}`, theme: "linen", tags,
      });
    }
  }
  await startViewer();
  const r = await fetch(`${viewerUrl}/`);
  const html = await r.text();
  // Slice just the tagbar so positions are meaningful
  const m = html.match(/<div class="v-tagbar">[\s\S]*?<\/div>\s*<\/div>/);
  expect(m).not.toBeNull();
  const tagbar = m![0];
  // Hrefs are URL-encoded; use them as stable position markers.
  const idxKindBug = tagbar.indexOf("/tag/kind%3Abug");
  const idxProjAlpha = tagbar.indexOf("/tag/project%3Aalpha");
  const idxSlotRoad = tagbar.indexOf("/tag/slot%3Aroadmap");
  const idxAlpha = tagbar.indexOf('href="/tag/alpha"');   // plain
  const idxBeta = tagbar.indexOf('href="/tag/beta"');
  const idxZeta = tagbar.indexOf('href="/tag/zeta"');
  expect(idxKindBug).toBeGreaterThan(-1);
  expect(idxProjAlpha).toBeGreaterThan(-1);
  expect(idxSlotRoad).toBeGreaterThan(-1);
  expect(idxAlpha).toBeGreaterThan(-1);
  expect(idxBeta).toBeGreaterThan(-1);
  expect(idxZeta).toBeGreaterThan(-1);
  // All three namespaced are before any plain
  expect(Math.max(idxKindBug, idxProjAlpha, idxSlotRoad)).toBeLessThan(Math.min(idxAlpha, idxBeta, idxZeta));
  // Within namespaced bucket: alpha-sorted (kind < project < slot)
  expect(idxKindBug).toBeLessThan(idxProjAlpha);
  expect(idxProjAlpha).toBeLessThan(idxSlotRoad);
  // Within plain bucket: alpha-sorted (alpha < beta < zeta)
  expect(idxAlpha).toBeLessThan(idxBeta);
  expect(idxBeta).toBeLessThan(idxZeta);
});

test("GET / no longer renders the bottom-of-list 'Tags · N popular' section (deduplicated)", async () => {
  await setup();
  const { createNote } = await import("../src/core/storage");
  await createNote({ type: "snippet", title: "a", body_html: "<p>x</p>",
    thread_id: "t1", theme: "linen", tags: ["project:demo"] });
  await createNote({ type: "snippet", title: "b", body_html: "<p>x</p>",
    thread_id: "t2", theme: "linen", tags: ["project:demo"] });
  await startViewer();
  const r = await fetch(`${viewerUrl}/`);
  const html = await r.text();
  // Header tagbar appears
  expect(html).toContain('class="v-tagbar"');
  // Old bottom section ("Tags · N popular") is gone
  expect(html).not.toMatch(/group-lbl[^>]*>Tags <span class="count">/);
});
