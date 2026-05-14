/**
 * Iteration notes storage layer — propose_round / pick_variant / state
 * computed from the live-entry JSONL substrate.
 */

import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDb } from "../src/core/db";

let homeDir: string;

beforeEach(async () => {
  homeDir = mkdtempSync(join(tmpdir(), "folio-iter-"));
  process.env.FOLIO_HOME = homeDir;
  const { init } = await import("../src/cli/commands/init");
  await init();
});

afterEach(() => {
  closeDb();
  rmSync(homeDir, { recursive: true, force: true });
  delete process.env.FOLIO_HOME;
});

async function makeIterNote() {
  const { createNote } = await import("../src/core/storage");
  return createNote({
    type: "iteration",
    title: "Design iteration test",
    body_html: "<h1>Landing page</h1><p>Iterating on hero layout.</p>",
    thread_id: "iter-test",
  });
}

test("createNote(type:iteration) stamps type + accepts minimal body", async () => {
  const note = await makeIterNote();
  const { getNoteMeta } = await import("../src/core/storage");
  const meta = getNoteMeta(note.id);
  expect(meta?.type).toBe("iteration");
});

test("getIterationState on a fresh iteration note: no rounds, no current", async () => {
  const note = await makeIterNote();
  const { getIterationState } = await import("../src/core/iteration");
  const state = getIterationState(note.id);
  expect(state).not.toBeNull();
  expect(state!.rounds).toHaveLength(0);
  expect(state!.lineage).toHaveLength(0);
  expect(state!.current_round).toBeNull();
  expect(state!.is_finalized).toBe(false);
});

test("proposeRound(round 1): creates 3 variants, current_round = round 1", async () => {
  const note = await makeIterNote();
  const { proposeRound, getIterationState } = await import("../src/core/iteration");
  const result = proposeRound({
    note_id: note.id,
    variants: [
      { content_html: "<div>Layout A</div>", label: "sidebar-L" },
      { content_html: "<div>Layout B</div>", label: "topnav-3" },
      { content_html: "<div>Layout C</div>", label: "editorial" },
    ],
  });
  expect(result.round).toBe(1);
  expect(result.variant_ids).toHaveLength(3);

  const state = getIterationState(note.id)!;
  expect(state.rounds).toHaveLength(1);
  expect(state.rounds[0]!.round).toBe(1);
  expect(state.rounds[0]!.variants).toHaveLength(3);
  expect(state.rounds[0]!.variants[0]!.label).toBe("sidebar-L");
  expect(state.rounds[0]!.variants[0]!.content_html).toBe("<div>Layout A</div>");
  expect(state.current_round?.round).toBe(1);
  expect(state.lineage).toHaveLength(0);
});

test("pickVariant: marks winner picked, siblings rejected, advances current_round to null", async () => {
  const note = await makeIterNote();
  const { proposeRound, pickVariant, getIterationState } = await import("../src/core/iteration");
  const round = proposeRound({
    note_id: note.id,
    variants: [
      { content_html: "<div>A</div>" },
      { content_html: "<div>B</div>" },
      { content_html: "<div>C</div>" },
    ],
  });
  const winner = round.variant_ids[1]!; // B wins
  const result = pickVariant({ note_id: note.id, variant_id: winner });
  expect(result.round).toBe(1);
  expect(result.variant_id).toBe(winner);
  expect(result.rejected_variant_ids).toHaveLength(2);

  const state = getIterationState(note.id)!;
  const r1 = state.rounds[0]!;
  expect(r1.picked_variant_id).toBe(winner);
  expect(r1.variants.find((v) => v.id === winner)!.state).toBe("picked");
  expect(r1.variants.filter((v) => v.id !== winner).every((v) => v.state === "rejected")).toBe(true);
  expect(state.lineage).toHaveLength(1);
  expect(state.lineage[0]!.id).toBe(winner);
  // No new round yet → current_round null.
  expect(state.current_round).toBeNull();
});

test("proposeRound(round 2): parent_variant_id must be the round 1 winner", async () => {
  const note = await makeIterNote();
  const { proposeRound, pickVariant } = await import("../src/core/iteration");
  const r1 = proposeRound({
    note_id: note.id,
    variants: [{ content_html: "<div>A</div>" }, { content_html: "<div>B</div>" }],
  });
  const winner = r1.variant_ids[0]!;
  pickVariant({ note_id: note.id, variant_id: winner });

  // Wrong parent → PARENT_MISMATCH.
  expect(() =>
    proposeRound({
      note_id: note.id,
      variants: [{ content_html: "<div>X</div>" }],
      parent_variant_id: "not-the-winner",
    })
  ).toThrow(/PARENT_MISMATCH|should be/);

  // Missing parent → also mismatch (expected = winner, got null).
  expect(() =>
    proposeRound({
      note_id: note.id,
      variants: [{ content_html: "<div>X</div>" }],
    })
  ).toThrow();

  // Correct parent → succeeds, round 2.
  const r2 = proposeRound({
    note_id: note.id,
    variants: [
      { content_html: "<div>A1</div>" },
      { content_html: "<div>A2</div>" },
    ],
    parent_variant_id: winner,
  });
  expect(r2.round).toBe(2);
  expect(r2.variant_ids).toHaveLength(2);
});

test("proposeRound when previous round is unpicked → ROUND_OPEN error", async () => {
  const note = await makeIterNote();
  const { proposeRound } = await import("../src/core/iteration");
  proposeRound({
    note_id: note.id,
    variants: [{ content_html: "<div>A</div>" }, { content_html: "<div>B</div>" }],
  });
  expect(() =>
    proposeRound({
      note_id: note.id,
      variants: [{ content_html: "<div>X</div>" }],
      parent_variant_id: "anything",
    })
  ).toThrow(/ROUND_OPEN|is open/);
});

test("pickVariant: unknown variant id → UNKNOWN_VARIANT", async () => {
  const note = await makeIterNote();
  const { proposeRound, pickVariant } = await import("../src/core/iteration");
  proposeRound({
    note_id: note.id,
    variants: [{ content_html: "<div>A</div>" }, { content_html: "<div>B</div>" }],
  });
  expect(() => pickVariant({ note_id: note.id, variant_id: "phantom-id" })).toThrow(/UNKNOWN_VARIANT|not found/);
});

test("pickVariant before any round → NO_OPEN_ROUND", async () => {
  const note = await makeIterNote();
  const { pickVariant } = await import("../src/core/iteration");
  expect(() => pickVariant({ note_id: note.id, variant_id: "anything" })).toThrow(/NO_OPEN_ROUND|no open round/);
});

test("proposeRound on non-iteration note → WRONG_TYPE", async () => {
  const { createNote } = await import("../src/core/storage");
  const note = await createNote({
    type: "snippet",
    title: "Regular note",
    body_html: "<p>x</p>",
    thread_id: "regular",
  });
  const { proposeRound } = await import("../src/core/iteration");
  expect(() =>
    proposeRound({
      note_id: note.id,
      variants: [{ content_html: "<div>A</div>" }],
    })
  ).toThrow(/WRONG_TYPE|not an iteration/);
});

test("full 3-round iteration: lineage grows, rounds chain via parent_variant_id", async () => {
  const note = await makeIterNote();
  const { proposeRound, pickVariant, getIterationState } = await import("../src/core/iteration");

  const r1 = proposeRound({
    note_id: note.id,
    variants: [
      { content_html: "<div>L1-A</div>", label: "sidebar" },
      { content_html: "<div>L1-B</div>", label: "topnav" },
      { content_html: "<div>L1-C</div>", label: "editorial" },
    ],
  });
  pickVariant({ note_id: note.id, variant_id: r1.variant_ids[1]! });
  const r2 = proposeRound({
    note_id: note.id,
    variants: [
      { content_html: "<div>L2-A</div>", label: "topnav-v1" },
      { content_html: "<div>L2-B</div>", label: "topnav-v2" },
    ],
    parent_variant_id: r1.variant_ids[1]!,
  });
  pickVariant({ note_id: note.id, variant_id: r2.variant_ids[0]! });
  const r3 = proposeRound({
    note_id: note.id,
    variants: [{ content_html: "<div>L3-final</div>" }],
    parent_variant_id: r2.variant_ids[0]!,
  });

  const state = getIterationState(note.id)!;
  expect(state.rounds).toHaveLength(3);
  expect(state.lineage).toHaveLength(2);  // 2 picks (round 3 still open)
  expect(state.lineage.map((v) => v.id)).toEqual([r1.variant_ids[1], r2.variant_ids[0]]);
  expect(state.current_round?.round).toBe(3);
  expect(state.current_round?.parent_variant_id).toBe(r2.variant_ids[0]!);
  expect(state.rounds[2]!.variants).toHaveLength(1);
});
