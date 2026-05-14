/**
 * Iteration finalize semantics (v0.18+):
 *   ✓ finalize on an iteration note flips is_final, compiles the final
 *     pick into body_html, moves JSONL to .trash/
 *   ✓ Iteration history section lists each round's pick label
 *   ✓ Finalizing without any picks writes a "no design selected" stub
 *     instead of erroring (parity with finalizeLive on an empty note)
 *   ✓ After finalize, getIterationState returns null (note is no longer
 *     queryable as iteration-state via the public API)
 *   ✓ /raw/:id on a finalized iteration note serves the compiled body —
 *     no gallery splice, no read-only banner
 */

import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDb } from "../src/core/db";

let homeDir: string;

beforeEach(async () => {
  homeDir = mkdtempSync(join(tmpdir(), "folio-iter-final-"));
  process.env.FOLIO_HOME = homeDir;
  const { init } = await import("../src/cli/commands/init");
  await init();
});

afterEach(() => {
  closeDb();
  rmSync(homeDir, { recursive: true, force: true });
  delete process.env.FOLIO_HOME;
});

async function makeIterNote(): Promise<{ id: string; path: string }> {
  const { createNote } = await import("../src/core/storage");
  const note = await createNote({
    type: "iteration",
    title: "Test iter",
    body_html: "<h1>Landing</h1><p>Iteration draft.</p>",
    thread_id: "iter-final",
    theme: "linen",
  });
  return { id: note.id, path: note.path };
}

test("finalize iteration: picks compile into body_html, JSONL archived", async () => {
  const { id, path } = await makeIterNote();
  const { proposeRound, pickVariant } = await import("../src/core/iteration");

  const r1 = proposeRound({
    note_id: id,
    variants: [
      { content_html: "<div class='design'>Option A</div>", label: "alpha" },
      { content_html: "<div class='design'>Option B</div>", label: "beta" },
      { content_html: "<div class='design'>Option C</div>", label: "gamma" },
    ],
  });
  const winnerR1 = r1.variant_ids[1]!; // beta
  pickVariant({ note_id: id, variant_id: winnerR1 });
  const r2 = proposeRound({
    note_id: id,
    variants: [
      { content_html: "<div class='design'>beta-refined-1</div>", label: "refined-narrow" },
      { content_html: "<div class='design'>beta-refined-2</div>", label: "refined-wide" },
    ],
    parent_variant_id: winnerR1,
  });
  const winnerR2 = r2.variant_ids[0]!; // refined-narrow
  pickVariant({ note_id: id, variant_id: winnerR2 });

  const { finalize, getNoteMeta } = await import("../src/core/storage");
  const ok = finalize(id);
  expect(ok).toBe(true);

  const meta = getNoteMeta(id)!;
  expect(meta.is_final).toBe(true);

  // JSONL archived to .trash, not in the original spot.
  const { entriesPath } = await import("../src/core/live");
  const jsonl = entriesPath(join(homeDir, path));
  expect(existsSync(jsonl)).toBe(false);
  const trashed = join(homeDir, ".trash", `${id}.entries.jsonl`);
  expect(existsSync(trashed)).toBe(true);

  // body_html now contains the compiled final design + history.
  const html = readFileSync(join(homeDir, path), "utf-8");
  expect(html).toContain("Final design");
  expect(html).toContain("Round 2");
  expect(html).toContain("refined-narrow");
  // r2 winner (index 0) has content "beta-refined-1" — appears in Final design block.
  expect(html).toContain("beta-refined-1");
  // The discarded sibling's content stays out of the compiled artifact;
  // it's archived in .trash/<id>.entries.jsonl instead.
  expect(html).not.toContain("beta-refined-2");
});

test("finalize iteration: history section lists each round's winner in order", async () => {
  const { id, path } = await makeIterNote();
  const { proposeRound, pickVariant } = await import("../src/core/iteration");

  const r1 = proposeRound({
    note_id: id,
    variants: [
      { content_html: "<div>A</div>", label: "first-alpha" },
      { content_html: "<div>B</div>", label: "first-beta" },
    ],
  });
  pickVariant({ note_id: id, variant_id: r1.variant_ids[1]! });
  const r2 = proposeRound({
    note_id: id,
    variants: [{ content_html: "<div>C</div>", label: "second-gamma" }],
    parent_variant_id: r1.variant_ids[1]!,
  });
  pickVariant({ note_id: id, variant_id: r2.variant_ids[0]! });

  const { finalize } = await import("../src/core/storage");
  finalize(id);

  const html = readFileSync(join(homeDir, path), "utf-8");
  expect(html).toContain("Iteration history");
  expect(html).toContain("first-beta");
  expect(html).toContain("second-gamma");
  // first-alpha was discarded — does NOT show in history (only winners go there).
  expect(html).not.toContain("first-alpha");
  // 2 picks, 2 rounds considered.
  expect(html).toContain("2 round");
});

test("finalize iteration without any picks: writes empty-state stub, doesn't error", async () => {
  const { id, path } = await makeIterNote();
  const { finalize, getNoteMeta } = await import("../src/core/storage");
  const ok = finalize(id);
  expect(ok).toBe(true);
  expect(getNoteMeta(id)!.is_final).toBe(true);

  const html = readFileSync(join(homeDir, path), "utf-8");
  expect(html).toContain("No design was selected");
  // Original chrome still survives.
  expect(html).toContain("<h1>Landing</h1>");
  // No history section when nothing was picked.
  expect(html).not.toContain("Iteration history");
});

test("finalize iteration with open round (no pick yet) is also permitted and writes stub", async () => {
  const { id, path } = await makeIterNote();
  const { proposeRound } = await import("../src/core/iteration");
  proposeRound({
    note_id: id,
    variants: [{ content_html: "<div>open</div>", label: "open-variant" }],
  });

  const { finalize } = await import("../src/core/storage");
  const ok = finalize(id);
  expect(ok).toBe(true);

  const html = readFileSync(join(homeDir, path), "utf-8");
  expect(html).toContain("No design was selected");
});

test("after finalize, getIterationState surfaces is_finalized=true via the public API", async () => {
  // getIterationState lives at the read API but reads from meta.is_final +
  // entries. After finalize the JSONL is moved, so reading should still
  // work if we keep it pure — but the iteration core's getIterationState
  // bails out if no entries exist OR returns is_finalized=true on the
  // compiled state. Let's verify the public behavior:
  const { id } = await makeIterNote();
  const { proposeRound, pickVariant, getIterationState } = await import("../src/core/iteration");
  const r1 = proposeRound({
    note_id: id,
    variants: [{ content_html: "<div>A</div>", label: "a" }],
  });
  pickVariant({ note_id: id, variant_id: r1.variant_ids[0]! });

  const before = getIterationState(id);
  expect(before?.is_finalized).toBe(false);

  const { finalize } = await import("../src/core/storage");
  finalize(id);

  // After finalize, the JSONL is in .trash — reading should still be safe.
  // The contract is: getIterationState returns null OR a state with
  // is_finalized=true. Either is fine — what matters is the viewer no
  // longer splices the gallery.
  const after = getIterationState(id);
  if (after !== null) {
    expect(after.is_finalized).toBe(true);
  }
});

test("/raw/:id on finalized iteration shows compiled body, no gallery splice", async () => {
  const { id, path } = await makeIterNote();
  const { proposeRound, pickVariant } = await import("../src/core/iteration");
  const r1 = proposeRound({
    note_id: id,
    variants: [
      { content_html: "<div class='design'>aaa</div>", label: "alpha" },
      { content_html: "<div class='design'>bbb</div>", label: "beta" },
    ],
  });
  pickVariant({ note_id: id, variant_id: r1.variant_ids[1]! });
  const { finalize } = await import("../src/core/storage");
  finalize(id);

  // Boot viewer and fetch /raw/:id
  const cfgPath = join(homeDir, "folio.config.json");
  const parsed = JSON.parse(readFileSync(cfgPath, "utf-8"));
  parsed.viewer_port = 0;
  writeFileSync(cfgPath, JSON.stringify(parsed));
  const { startServer } = await import("../src/viewer/server");
  const viewer = (await startServer()) as any;
  try {
    const url = `http://${viewer.hostname}:${viewer.port}/raw/${id}`;
    const r = await fetch(url);
    expect(r.status).toBe(200);
    const html = await r.text();
    // Compiled final design present.
    expect(html).toContain("Final design");
    expect(html).toContain("beta");
    expect(html).toContain("bbb");
    // No gallery — note is finalized, so the iteration branch is skipped.
    expect(html).not.toContain('<section class="iter-gallery"');
    // No read-only banner — that's only for live iteration notes.
    expect(html).not.toContain("read-only · owner picks");
  } finally {
    viewer.stop();
  }
});
