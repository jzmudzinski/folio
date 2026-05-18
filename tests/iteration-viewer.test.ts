/**
 * Iteration viewer tests (v0.18+):
 *   - renderIterationRaw produces the expected gallery / breadcrumb /
 *     empty-state HTML across the round states (fresh, mid-pick,
 *     post-pick waiting, multi-round lineage).
 *   - /raw/:id for an iteration note splices the gallery into
 *     <article data-folio-content>, preserving chrome around it.
 *   - /api/notes/:id/iter/pick accepts a variant_id and returns the
 *     pick payload; /api/notes/:id/iter/state returns a state snapshot.
 *   - /api/notes/:id/iter/pick returns 400 for invalid input.
 *
 * These cover the HTTP surface added in src/viewer/server.ts.
 */

import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDb } from "../src/core/db";
import { renderIterationRaw } from "../src/viewer/iteration-render";
import { computeIterationState, type Variant } from "../src/core/iteration";

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
  homeDir = mkdtempSync(join(tmpdir(), "folio-iter-viewer-"));
  process.env.FOLIO_HOME = homeDir;
});

afterEach(() => {
  try { viewer?.stop(); } catch {}
  viewer = null;
  closeDb();
  rmSync(homeDir, { recursive: true, force: true });
  delete process.env.FOLIO_HOME;
});

// ───── Pure renderer ─────────────────────────────────────────────────────

test("renderIterationRaw: empty state (no rounds yet) renders waiting prompt", () => {
  const html = renderIterationRaw({
    noteId: "abc123",
    title: "x",
    chromeHtml: "<h1>Hello</h1>",
    state: { rounds: [], lineage: [], current_round: null, is_finalized: false },
  });
  expect(html).toContain("iter-empty");
  expect(html).toContain("No variants yet");
  expect(html).toContain("propose_round");
  expect(html).toContain("<h1>Hello</h1>");
  // The CSS block defines .iter-gallery__grid, so we can't pattern-match
  // on the bare class name — check the actual gallery <section> markup
  // that only the renderer's gallery branch emits.
  expect(html).not.toContain('<section class="iter-gallery"');
});

test("renderIterationRaw: current round renders one card per variant + pick button per open card", () => {
  const variants: Variant[] = [
    { id: "v1", round: 1, parent_variant_id: null, label: "A", content_html: "<p>aaa</p>", ts: "t", state: "open" },
    { id: "v2", round: 1, parent_variant_id: null, label: "B", content_html: "<p>bbb</p>", ts: "t", state: "open" },
    { id: "v3", round: 1, parent_variant_id: null, label: "C", content_html: "<p>ccc</p>", ts: "t", state: "open" },
  ];
  const html = renderIterationRaw({
    noteId: "n1",
    title: "x",
    chromeHtml: "",
    state: {
      rounds: [{ round: 1, parent_variant_id: null, variants, picked_variant_id: null, picked_at: null }],
      lineage: [],
      current_round: { round: 1, parent_variant_id: null, variants, picked_variant_id: null, picked_at: null },
      is_finalized: false,
    },
  });
  expect(html).toContain('data-variant-id="v1"');
  expect(html).toContain('data-variant-id="v2"');
  expect(html).toContain('data-variant-id="v3"');
  // The CSS block references .iter-card__pick — restrict to the actual
  // button element's class attribute to count emitted pick buttons.
  expect((html.match(/<button[^>]*class="iter-card__pick"/g) ?? []).length).toBe(3);
  expect(html).toContain("Round 1");
  expect(html).toContain("3 variants");
});

test("renderIterationRaw: waiting state appears after a pick when no next round proposed", () => {
  const variantEntries = [1, 2, 3].map((i) => ({
    id: `e${i}`,
    ts: "2026-05-14T10:00:00Z",
    content_html: `<p>v${i}</p>`,
    plain: `v${i}`,
    tags: ["kind:variant", "round:1"],
    refs: undefined,
    source_ref: `label-${i}`,
  }));
  const pickEntry = {
    id: "epick",
    ts: "2026-05-14T10:05:00Z",
    content_html: "",
    plain: "",
    tags: ["kind:pick", "round:1"],
    refs: ["e2"],
  };
  const state = computeIterationState("nid", [...variantEntries, pickEntry] as any, false);
  expect(state.current_round).toBeNull();
  expect(state.lineage).toHaveLength(1);
  expect(state.lineage[0]!.id).toBe("e2");

  const html = renderIterationRaw({ noteId: "nid", title: "t", chromeHtml: "", state });
  expect(html).toContain("Waiting for the agent to propose round 2");
  expect(html).toContain("iter-bc");
  expect(html).toContain("label-2");
});

test("renderIterationRaw: breadcrumb chains across multiple picked rounds", () => {
  const state = {
    rounds: [],
    lineage: [
      { id: "a", round: 1, parent_variant_id: null, label: "A", content_html: "", ts: "t", state: "picked" as const },
      { id: "b", round: 2, parent_variant_id: "a", label: "B", content_html: "", ts: "t", state: "picked" as const },
      { id: "c", round: 3, parent_variant_id: "b", label: "C", content_html: "", ts: "t", state: "picked" as const },
    ],
    current_round: null,
    is_finalized: false,
  };
  const html = renderIterationRaw({ noteId: "n", title: "t", chromeHtml: "", state });
  expect(html).toContain("R1");
  expect(html).toContain("R2");
  expect(html).toContain("R3");
  // CSS block references .iter-bc__arrow — count the actual <span> arrow
  // separators rendered between breadcrumb steps.
  expect((html.match(/<span class="iter-bc__arrow">/g) ?? []).length).toBe(2);
});

test("renderIterationRaw v0.23: density toolbar present + auto-density picks 3 for compact gallery", () => {
  const variants: Variant[] = [
    { id: "v1", round: 1, parent_variant_id: null, label: "a", content_html: "<p>tiny</p>", ts: "t", state: "open" },
    { id: "v2", round: 1, parent_variant_id: null, label: "b", content_html: "<p>also tiny</p>", ts: "t", state: "open" },
    { id: "v3", round: 1, parent_variant_id: null, label: "c", content_html: "<p>still tiny</p>", ts: "t", state: "open" },
  ];
  const html = renderIterationRaw({
    noteId: "n",
    title: "t",
    chromeHtml: "",
    state: {
      rounds: [{ round: 1, parent_variant_id: null, variants, picked_variant_id: null, picked_at: null }],
      lineage: [],
      current_round: { round: 1, parent_variant_id: null, variants, picked_variant_id: null, picked_at: null },
      is_finalized: false,
    },
  });
  expect(html).toContain('class="iter-gallery__density"');
  expect(html).toContain('data-cols="1"');
  expect(html).toContain('data-cols="2"');
  expect(html).toContain('data-cols="3"');
  // 3 small variants → grid defaults to 3-col density
  expect(html).toMatch(/<div class="iter-gallery__grid" data-cols="3"/);
});

test("renderIterationRaw v0.23: auto-density picks 2 for 4+ variants with light content", () => {
  const mkVariant = (i: number): Variant => ({
    id: `v${i}`, round: 1, parent_variant_id: null, label: `v${i}`,
    content_html: "<p>short content</p>", ts: "t", state: "open",
  });
  const variants = [1, 2, 3, 4, 5].map(mkVariant);
  const html = renderIterationRaw({
    noteId: "n",
    title: "t",
    chromeHtml: "",
    state: {
      rounds: [{ round: 1, parent_variant_id: null, variants, picked_variant_id: null, picked_at: null }],
      lineage: [],
      current_round: { round: 1, parent_variant_id: null, variants, picked_variant_id: null, picked_at: null },
      is_finalized: false,
    },
  });
  expect(html).toMatch(/<div class="iter-gallery__grid" data-cols="2"/);
});

test("renderIterationRaw v0.23: auto-density picks 1 for 4+ heavy-content variants", () => {
  const heavyContent = "<p>" + "x".repeat(7000) + "</p>";
  const mkVariant = (i: number): Variant => ({
    id: `v${i}`, round: 1, parent_variant_id: null, label: `v${i}`,
    content_html: heavyContent, ts: "t", state: "open",
  });
  const variants = [1, 2, 3, 4, 5, 6].map(mkVariant);
  const html = renderIterationRaw({
    noteId: "n",
    title: "t",
    chromeHtml: "",
    state: {
      rounds: [{ round: 1, parent_variant_id: null, variants, picked_variant_id: null, picked_at: null }],
      lineage: [],
      current_round: { round: 1, parent_variant_id: null, variants, picked_variant_id: null, picked_at: null },
      is_finalized: false,
    },
  });
  expect(html).toMatch(/<div class="iter-gallery__grid" data-cols="1"/);
});

test("renderIterationRaw v0.23: bootstrap script handles density toolbar clicks + localStorage", () => {
  const variants: Variant[] = [
    { id: "v1", round: 1, parent_variant_id: null, label: "a", content_html: "<p>x</p>", ts: "t", state: "open" },
  ];
  const html = renderIterationRaw({
    noteId: "n",
    title: "t",
    chromeHtml: "",
    state: {
      rounds: [{ round: 1, parent_variant_id: null, variants, picked_variant_id: null, picked_at: null }],
      lineage: [],
      current_round: { round: 1, parent_variant_id: null, variants, picked_variant_id: null, picked_at: null },
      is_finalized: false,
    },
  });
  expect(html).toContain("folio-iter-density:");
  expect(html).toContain("localStorage.setItem");
  expect(html).toContain("syncButtons");
});

test("renderIterationRaw: escapes variant labels into card attributes", () => {
  const variants: Variant[] = [
    { id: 'v"1', round: 1, parent_variant_id: null, label: "<script>x</script>", content_html: "<p>x</p>", ts: "t", state: "open" },
  ];
  const html = renderIterationRaw({
    noteId: "n",
    title: "t",
    chromeHtml: "",
    state: {
      rounds: [{ round: 1, parent_variant_id: null, variants, picked_variant_id: null, picked_at: null }],
      lineage: [],
      current_round: { round: 1, parent_variant_id: null, variants, picked_variant_id: null, picked_at: null },
      is_finalized: false,
    },
  });
  expect(html).not.toContain("<script>x</script>");
  expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
});

// ───── HTTP integration ──────────────────────────────────────────────────

test("/raw/:id splices iteration gallery into article body", async () => {
  await bootViewer();
  const { createNote } = await import("../src/core/storage");
  const note = await createNote({
    type: "iteration",
    title: "Landing iteration",
    body_html: "<h1>Landing</h1><p>Pick a layout.</p>",
    thread_id: "iter-viewer",
    theme: "linen",
  });
  const { proposeRound } = await import("../src/core/iteration");
  proposeRound({
    note_id: note.id,
    variants: [
      { content_html: "<div>Layout A</div>", label: "sidebar" },
      { content_html: "<div>Layout B</div>", label: "topnav" },
    ],
  });

  const r = await fetch(`${viewerUrl}/raw/${note.id}`);
  expect(r.status).toBe(200);
  const html = await r.text();
  expect(html).toContain("<h1>Landing</h1>");
  // Match the actual gallery <section> wrapper, not just the class name —
  // the CSS block contains .iter-gallery__grid as a rule selector.
  expect(html).toContain('<section class="iter-gallery"');
  expect(html).toContain("sidebar");
  expect(html).toContain("topnav");
  expect(html).toContain("iteration-pick");
});

test("POST /api/notes/:id/iter/pick returns pick payload; /raw reflects waiting state afterward", async () => {
  await bootViewer();
  const { createNote } = await import("../src/core/storage");
  const note = await createNote({
    type: "iteration",
    title: "Iter pick e2e",
    body_html: "<h1>X</h1>",
    thread_id: "iter-viewer-pick",
    theme: "linen",
  });
  const { proposeRound } = await import("../src/core/iteration");
  const r1 = proposeRound({
    note_id: note.id,
    variants: [
      { content_html: "<div>A</div>", label: "alpha" },
      { content_html: "<div>B</div>", label: "beta" },
    ],
  });
  const winnerId = r1.variant_ids[1]!;

  const pickResp = await fetch(`${viewerUrl}/api/notes/${note.id}/iter/pick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ variant_id: winnerId }),
  });
  expect(pickResp.status).toBe(200);
  const pickData = await pickResp.json() as any;
  expect(pickData.round).toBe(1);
  expect(pickData.variant_id).toBe(winnerId);

  const stateResp = await fetch(`${viewerUrl}/api/notes/${note.id}/iter/state`);
  expect(stateResp.status).toBe(200);
  const state = await stateResp.json() as any;
  expect(state.current_round).toBeNull();
  expect(state.lineage).toHaveLength(1);
  expect(state.lineage[0].id).toBe(winnerId);

  const rawResp = await fetch(`${viewerUrl}/raw/${note.id}`);
  const rawHtml = await rawResp.text();
  expect(rawHtml).toContain("Waiting for the agent to propose round 2");
  // Same caveat as the empty-state test — CSS defines .iter-gallery__grid,
  // so match the actual <section> wrapper that only the gallery branch emits.
  expect(rawHtml).not.toContain('<section class="iter-gallery"');
});

test("POST /api/notes/:id/iter/pick rejects missing variant_id with 400", async () => {
  await bootViewer();
  const { createNote } = await import("../src/core/storage");
  const note = await createNote({
    type: "iteration",
    title: "Bad input",
    body_html: "<h1>x</h1>",
    thread_id: "iter-bad-input",
    theme: "linen",
  });
  const r = await fetch(`${viewerUrl}/api/notes/${note.id}/iter/pick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(r.status).toBe(400);
  const data = await r.json() as any;
  expect(data.error).toContain("variant_id");
});

test("GET /api/notes/:id/iter/state on non-iteration note returns 404", async () => {
  await bootViewer();
  const { createNote } = await import("../src/core/storage");
  const note = await createNote({
    type: "snippet",
    title: "Just a snippet",
    body_html: "<p>x</p>",
    thread_id: "snip-thread",
    theme: "linen",
  });
  const r = await fetch(`${viewerUrl}/api/notes/${note.id}/iter/state`);
  expect(r.status).toBe(404);
});

// ───── v0.20.2: SSE auto-refresh for iteration gallery ─────────────────

test("v0.20.2: GET /n/:id/stream accepts iteration notes (previously 404'd)", async () => {
  await bootViewer();
  const { createNote } = await import("../src/core/storage");
  const note = await createNote({
    type: "iteration",
    title: "Stream test",
    body_html: "<h1>x</h1>",
    thread_id: "stream-iter",
    theme: "linen",
  });

  // EventSource isn't trivial to test directly in bun:test; just verify the
  // endpoint returns a streamable response with text/event-stream MIME and
  // doesn't 404 (which it would pre-v0.20.2 because note.live === false).
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 200);
  let res: Response | null = null;
  try {
    res = await fetch(`${viewerUrl}/n/${note.id}/stream`, { signal: ctrl.signal });
  } catch {
    // AbortError after the timeout is expected — we only care that the
    // initial response came back 200 with the SSE content-type.
  }
  if (res) {
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/event-stream");
    try { await res.body?.cancel(); } catch {}
  }
});

test("v0.20.2: GET /n/:id/stream still 404s on plain (non-live, non-iteration) note", async () => {
  await bootViewer();
  const { createNote } = await import("../src/core/storage");
  const note = await createNote({
    type: "snippet",
    title: "regular",
    body_html: "<p>x</p>",
    thread_id: "plain-thread",
    theme: "linen",
  });
  const r = await fetch(`${viewerUrl}/n/${note.id}/stream`);
  expect(r.status).toBe(404);
});

test("v0.20.2: iteration note page embeds EventSource subscriber that reloads on kind:variant entries", async () => {
  await bootViewer();
  const { createNote } = await import("../src/core/storage");
  const note = await createNote({
    type: "iteration",
    title: "Reload test",
    body_html: "<h1>x</h1>",
    thread_id: "reload-iter",
    theme: "linen",
  });
  const r = await fetch(`${viewerUrl}/n/${note.id}`);
  const html = await r.text();
  // The chrome JS opens SSE on /n/:id/stream
  expect(html).toContain('new EventSource("/n/" + encodeURIComponent(noteId) + "/stream")');
  // Only kind:variant entries trigger reload — kind:pick is skipped to avoid double-reload
  expect(html).toContain('"kind:variant"');
  expect(html).toContain('bodyFrame.src = "/raw/"');
});

test("v0.20.2: regular (non-iteration, non-live) note has NO SSE subscriber injected", async () => {
  await bootViewer();
  const { createNote } = await import("../src/core/storage");
  const note = await createNote({
    type: "snippet",
    title: "Plain note",
    body_html: "<p>x</p>",
    thread_id: "no-sse",
    theme: "linen",
  });
  const r = await fetch(`${viewerUrl}/n/${note.id}`);
  const html = await r.text();
  // Plain notes shouldn't get the iteration's EventSource block
  expect(html).not.toContain('new EventSource("/n/" + encodeURIComponent(noteId) + "/stream")');
});
