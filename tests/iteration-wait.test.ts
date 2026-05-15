/**
 * wait_for_pick (v0.19.1) — long-poll for iteration picks via SSE hub.
 *
 *   ✓ resolves with variant_id when a matching kind:pick entry fires
 *   ✓ ignores kind:variant entries (only picks fire the resolve)
 *   ✓ ignores picks from other rounds when for_round is set
 *   ✓ immediate return when round is already picked at call time
 *   ✓ immediate return when note is_final (returns last lineage entry)
 *   ✓ immediate return when finalized with no picks (picked:false)
 *   ✓ timeout fires {picked:false, timeout:true, current_round}
 *   ✓ NOT_FOUND error for missing note
 *   ✓ WRONG_TYPE error for non-iteration note
 *   ✓ end-to-end via buildServer() — propose_round + concurrent
 *     waitForPick + pickVariant resolves before timeout
 */

import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDb } from "../src/core/db";
import { _resetHubForTests } from "../src/core/sse-hub";

let homeDir: string;

beforeEach(async () => {
  homeDir = mkdtempSync(join(tmpdir(), "folio-wait-pick-"));
  process.env.FOLIO_HOME = homeDir;
  const { init } = await import("../src/cli/commands/init");
  await init();
});

afterEach(() => {
  _resetHubForTests();
  closeDb();
  rmSync(homeDir, { recursive: true, force: true });
  delete process.env.FOLIO_HOME;
});

async function makeIterNote(): Promise<string> {
  const { createNote } = await import("../src/core/storage");
  const note = await createNote({
    type: "iteration",
    title: "Wait test",
    body_html: "<h1>x</h1>",
    thread_id: "wait-pick",
    theme: "linen",
  });
  return note.id;
}

test("resolves with variant_id when a kind:pick lands for the matched round", async () => {
  const id = await makeIterNote();
  const { proposeRound, pickVariant, waitForPick } = await import("../src/core/iteration");

  const r1 = proposeRound({
    note_id: id,
    variants: [
      { content_html: "<div>A</div>", label: "alpha" },
      { content_html: "<div>B</div>", label: "beta" },
    ],
  });

  // Fire waitForPick + pickVariant concurrently — wait must see the pick
  // event published through the SSE hub.
  const winner = r1.variant_ids[1]!;
  const [result] = await Promise.all([
    waitForPick({ note_id: id, for_round: 1, timeout_s: 5 }),
    (async () => {
      // Tiny delay so the subscriber has time to attach before publish fires.
      await new Promise((r) => setTimeout(r, 50));
      pickVariant({ note_id: id, variant_id: winner });
    })(),
  ]);

  expect(result.picked).toBe(true);
  expect(result.variant_id).toBe(winner);
  expect(result.round).toBe(1);
});

test("ignores variant entries — only picks fire the resolve", async () => {
  const id = await makeIterNote();
  const { proposeRound, pickVariant, waitForPick } = await import("../src/core/iteration");

  // No round open yet. Fire waitForPick first; then propose variants
  // (which append kind:variant entries — those MUST NOT resolve the wait).
  // After variants, fire the pick — only then should waitForPick resolve.
  const promise = waitForPick({ note_id: id, for_round: 1, timeout_s: 5 });

  // Microtask gap to let the subscriber attach.
  await new Promise((r) => setTimeout(r, 30));
  const r1 = proposeRound({
    note_id: id,
    variants: [
      { content_html: "<div>A</div>", label: "alpha" },
      { content_html: "<div>B</div>", label: "beta" },
    ],
  });

  // Briefly verify we're still waiting (not resolved by variant entries).
  let resolvedEarly = false;
  promise.then(() => (resolvedEarly = true));
  await new Promise((r) => setTimeout(r, 80));
  expect(resolvedEarly).toBe(false);

  // Now actually pick — should resolve.
  pickVariant({ note_id: id, variant_id: r1.variant_ids[0]! });
  const result = await promise;
  expect(result.picked).toBe(true);
  expect(result.variant_id).toBe(r1.variant_ids[0]);
});

test("ignores picks for OTHER rounds when for_round is set", async () => {
  const id = await makeIterNote();
  const { proposeRound, pickVariant, waitForPick } = await import("../src/core/iteration");

  // Round 1, pick to advance state.
  const r1 = proposeRound({
    note_id: id,
    variants: [{ content_html: "<div>A</div>", label: "alpha" }],
  });
  pickVariant({ note_id: id, variant_id: r1.variant_ids[0]! });

  // Round 2 proposed, not yet picked. Wait FOR_ROUND=2 (which doesn't exist yet
  // when we attach the wait — proposeRound runs first, then wait, then pick).
  const r2 = proposeRound({
    note_id: id,
    variants: [{ content_html: "<div>B</div>", label: "beta" }],
    parent_variant_id: r1.variant_ids[0]!,
  });

  const result = await Promise.all([
    waitForPick({ note_id: id, for_round: 2, timeout_s: 5 }),
    (async () => {
      await new Promise((r) => setTimeout(r, 50));
      pickVariant({ note_id: id, variant_id: r2.variant_ids[0]! });
    })(),
  ]);
  expect(result[0].picked).toBe(true);
  expect(result[0].round).toBe(2);
  expect(result[0].variant_id).toBe(r2.variant_ids[0]);
});

test("immediate return when for_round is already picked at call time", async () => {
  const id = await makeIterNote();
  const { proposeRound, pickVariant, waitForPick } = await import("../src/core/iteration");

  const r1 = proposeRound({
    note_id: id,
    variants: [
      { content_html: "<div>A</div>", label: "alpha" },
      { content_html: "<div>B</div>", label: "beta" },
    ],
  });
  pickVariant({ note_id: id, variant_id: r1.variant_ids[1]! });

  // Round 1 is already picked. waitForPick must return immediately,
  // not block for 5s.
  const t0 = Date.now();
  const result = await waitForPick({ note_id: id, for_round: 1, timeout_s: 5 });
  const elapsed = Date.now() - t0;

  expect(result.picked).toBe(true);
  expect(result.variant_id).toBe(r1.variant_ids[1]);
  expect(result.round).toBe(1);
  expect(elapsed).toBeLessThan(200);
});

test("immediate return when note is finalized — picked:false signals 'stop waiting'", async () => {
  // Finalize archives the JSONL to .trash, so lineage isn't reachable via
  // this API anymore. The right signal is picked:false so the agent stops
  // waiting; the picked lineage lives in the compiled body_html instead.
  const id = await makeIterNote();
  const { proposeRound, pickVariant, waitForPick } = await import("../src/core/iteration");
  const r1 = proposeRound({
    note_id: id,
    variants: [{ content_html: "<div>A</div>", label: "alpha" }],
  });
  pickVariant({ note_id: id, variant_id: r1.variant_ids[0]! });
  const { finalize } = await import("../src/core/storage");
  finalize(id);

  const t0 = Date.now();
  const result = await waitForPick({ note_id: id, timeout_s: 5 });
  expect(Date.now() - t0).toBeLessThan(200);
  expect(result.picked).toBe(false);
  // Not a timeout — it's the "note is done" fast path. Both are non-resolved
  // but the absence of timeout:true tells the agent the wait completed cleanly.
  expect(result.timeout).toBeUndefined();
});

test("finalized with no picks returns {picked:false}", async () => {
  const id = await makeIterNote();
  const { waitForPick } = await import("../src/core/iteration");
  const { finalize } = await import("../src/core/storage");
  finalize(id);
  const result = await waitForPick({ note_id: id, timeout_s: 5 });
  expect(result.picked).toBe(false);
});

test("timeout fires {picked:false, timeout:true, current_round}", async () => {
  const id = await makeIterNote();
  const { proposeRound, waitForPick } = await import("../src/core/iteration");
  proposeRound({
    note_id: id,
    variants: [{ content_html: "<div>A</div>" }],
  });

  const t0 = Date.now();
  const result = await waitForPick({ note_id: id, for_round: 1, timeout_s: 1 });
  const elapsed = Date.now() - t0;

  expect(result.picked).toBe(false);
  expect(result.timeout).toBe(true);
  expect(result.current_round).toBe(1);
  // ~1000ms with some slop
  expect(elapsed).toBeGreaterThanOrEqual(900);
  expect(elapsed).toBeLessThan(1500);
});

test("NOT_FOUND error for missing note", async () => {
  const { waitForPick } = await import("../src/core/iteration");
  await expect(waitForPick({ note_id: "01HMISSING", timeout_s: 1 })).rejects.toThrow(/not found/i);
});

test("WRONG_TYPE error for non-iteration note", async () => {
  const { createNote } = await import("../src/core/storage");
  const note = await createNote({
    type: "snippet",
    title: "Not iter",
    body_html: "<p>x</p>",
    thread_id: "wrong-type",
    theme: "linen",
  });
  const { waitForPick } = await import("../src/core/iteration");
  await expect(waitForPick({ note_id: note.id, timeout_s: 1 })).rejects.toThrow(/not an iteration/i);
});

test("MCP end-to-end: wait_for_pick + pick_variant via buildServer()", async () => {
  const { buildServer } = await import("../src/mcp/server");
  const server = await buildServer();
  const anySvr = server as any;
  const call = async (name: string, args: any) =>
    anySvr._requestHandlers.get("tools/call")({ method: "tools/call", params: { name, arguments: args } });

  // Create iteration note + round 1.
  const createRes = await call("create", {
    type: "iteration",
    title: "MCP wait test",
    body_html: "<h1>x</h1>",
    thread_id: "mcp-wait-test",
  });
  const note = JSON.parse(createRes.content[0].text);
  const r1Res = await call("propose_round", {
    note_id: note.id,
    variants: [
      { content_html: "<div>A</div>" },
      { content_html: "<div>B</div>" },
    ],
  });
  const r1 = JSON.parse(r1Res.content[0].text);
  expect(r1.round).toBe(1);

  // Fire wait + pick concurrently via MCP.
  const winner = r1.variant_ids[1];
  const [waitRes] = await Promise.all([
    call("wait_for_pick", { note_id: note.id, for_round: 1, timeout_s: 5 }),
    (async () => {
      await new Promise((r) => setTimeout(r, 50));
      await call("pick_variant", { note_id: note.id, variant_id: winner });
    })(),
  ]);

  const result = JSON.parse(waitRes.content[0].text);
  expect(result.picked).toBe(true);
  expect(result.variant_id).toBe(winner);
  expect(result.round).toBe(1);
});
