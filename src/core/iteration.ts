/**
 * Iteration notes (v0.18+) — design-iteration primitive.
 *
 * Storage: reuses the live-entry JSONL substrate. Each variant + pick is
 * an append_entry under the hood, tagged with normalized discriminators
 * so the iteration renderer / API can reconstruct the round/variant tree:
 *
 *   variant entry:
 *     tags: ["kind:variant", "round:<N>", optionally "parent:<variant_id>"]
 *     content_html: the variant's HTML payload (full mockup / poster / etc.)
 *     id: serves as the variant_id
 *
 *   pick entry:
 *     tags: ["kind:pick", "round:<N>"]
 *     refs: [picked_variant_id]
 *     content_html: empty (no need to render — pick is metadata)
 *
 * Logical model (computed from entries):
 *   - rounds[]: each round has round_id (= N) and variants[]
 *   - lineage[]: ordered list of picked variants (one per finished round)
 *   - current_round: the round with no pick event yet (or first if none)
 *
 * Why reuse live entries instead of new tables:
 *   - Sync, SSE, append-only, storage, tombstones all work for free
 *   - Variants ARE entries semantically; "round" is just a tag convention
 *   - Future migration to dedicated schema is contained — only this module
 *     and the renderer change, agent API stays the same
 *
 * The agent-facing API (`propose_round`, `pick_variant`, `state`) hides
 * the entry/tag plumbing — agents think in rounds + variants + parents.
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { ulid } from "ulid";
import { db } from "./db";
import { folioRoot } from "./config";
import { getNoteMeta, updateLastEntryAt } from "./storage";
import { appendEntry, entriesPath, readEntries } from "./live";
import { subscribe } from "./sse-hub";
import type { LiveEntry } from "./types";

// ---- Logical model ----

export interface Variant {
  id: string;             // = LiveEntry.id; agent-visible
  round: number;
  parent_variant_id: string | null;
  label: string | null;   // optional display name
  content_html: string;
  ts: string;
  state: "open" | "picked" | "rejected";
}

export interface Round {
  round: number;
  parent_variant_id: string | null;
  variants: Variant[];
  picked_variant_id: string | null;   // null until pick event lands
  picked_at: string | null;
}

export interface IterationState {
  note_id: string;
  rounds: Round[];                    // ordered by round number ascending
  lineage: Variant[];                 // picked variants, one per finished round, ordered
  current_round: Round | null;        // first round without a pick (the open one)
  is_finalized: boolean;              // = note.is_final
}

// ---- Tag helpers ----

const TAG_KIND = "kind:";
const TAG_ROUND = "round:";
const TAG_PARENT = "parent:";

function tag(prefix: string, value: string | number): string {
  return prefix + value;
}

function findTag(tags: string[] | undefined, prefix: string): string | null {
  if (!tags) return null;
  for (const t of tags) if (t.startsWith(prefix)) return t.slice(prefix.length);
  return null;
}

function kindOf(entry: LiveEntry): "variant" | "pick" | null {
  const k = findTag(entry.tags, TAG_KIND);
  return k === "variant" || k === "pick" ? k : null;
}

// ---- State reconstruction ----

/**
 * Compute the IterationState from the JSONL. Pure function over entries —
 * easy to test, easy to render. Variants of a round are ordered by their
 * entry.ts (chronological). Rounds are numbered from the `round:N` tag;
 * if multiple variants disagree on round number for some reason (manual
 * append?), the lowest wins for grouping.
 */
export function computeIterationState(noteId: string, entries: LiveEntry[], isFinalized: boolean): IterationState {
  const variants: Variant[] = [];
  const picks = new Map<number, { variant_id: string; ts: string }>();

  for (const e of entries) {
    const k = kindOf(e);
    if (k === "variant") {
      const roundStr = findTag(e.tags, TAG_ROUND);
      if (!roundStr) continue;  // malformed, skip
      const round = Number(roundStr);
      if (!Number.isFinite(round)) continue;
      const parent = findTag(e.tags, TAG_PARENT);
      variants.push({
        id: e.id,
        round,
        parent_variant_id: parent || null,
        label: e.source_ref ?? null,
        content_html: e.content_html,
        ts: e.ts,
        state: "open",
      });
    } else if (k === "pick") {
      const roundStr = findTag(e.tags, TAG_ROUND);
      const winnerId = (e.refs && e.refs[0]) ?? null;
      if (!roundStr || !winnerId) continue;
      const round = Number(roundStr);
      if (!Number.isFinite(round)) continue;
      // First pick for a round wins (subsequent picks ignored — append-only
      // means we can't "undo" but we can ignore extras).
      if (!picks.has(round)) picks.set(round, { variant_id: winnerId, ts: e.ts });
    }
  }

  // Annotate variants with picked/rejected state.
  for (const v of variants) {
    const pickedForRound = picks.get(v.round);
    if (pickedForRound) {
      v.state = pickedForRound.variant_id === v.id ? "picked" : "rejected";
    }
  }

  // Group into rounds.
  const byRound = new Map<number, Variant[]>();
  for (const v of variants) {
    const arr = byRound.get(v.round) ?? [];
    arr.push(v);
    byRound.set(v.round, arr);
  }
  const roundNums = Array.from(byRound.keys()).sort((a, b) => a - b);
  const rounds: Round[] = roundNums.map((n) => {
    const vs = (byRound.get(n) ?? []).sort((a, b) => a.ts.localeCompare(b.ts));
    const pick = picks.get(n);
    // Parent is the parent_variant_id of any variant in the round (they
    // should agree; if not, take the first).
    const parent = vs.length > 0 ? vs[0]!.parent_variant_id : null;
    return {
      round: n,
      parent_variant_id: parent,
      variants: vs,
      picked_variant_id: pick?.variant_id ?? null,
      picked_at: pick?.ts ?? null,
    };
  });

  const lineage: Variant[] = [];
  for (const r of rounds) {
    if (!r.picked_variant_id) break;
    const winner = r.variants.find((v) => v.id === r.picked_variant_id);
    if (winner) lineage.push(winner);
  }

  const current_round = rounds.find((r) => r.picked_variant_id === null) ?? null;

  return {
    note_id: noteId,
    rounds,
    lineage,
    current_round,
    is_finalized: isFinalized,
  };
}

// ---- Read API ----

export function getIterationState(noteId: string): IterationState | null {
  const meta = getNoteMeta(noteId);
  if (!meta) return null;
  if (meta.type !== "iteration") return null;
  const jsonl = entriesPath(join(folioRoot(), meta.path));
  const entries = existsSync(jsonl) ? readEntries(jsonl) : [];
  return computeIterationState(noteId, entries, meta.is_final);
}

// ---- Write API ----

export interface VariantInput {
  content_html: string;
  label?: string | null;
}

export interface ProposeRoundInput {
  note_id: string;
  variants: VariantInput[];
  parent_variant_id?: string | null;  // omit for round 1
}

export interface ProposeRoundResult {
  round: number;
  variant_ids: string[];
}

export class IterationError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

/**
 * Propose a fresh round of variants. Round number is derived: if there are
 * no existing rounds, this is round 1; otherwise it's max(existing_round)+1
 * iff the previous round has been picked. Proposing into a round when the
 * previous one is still open errors with ROUND_OPEN (use pick_variant
 * first).
 *
 * `parent_variant_id` must reference the picked variant of the previous
 * round (or null for round 1). Mismatch errors with PARENT_MISMATCH.
 */
export function proposeRound(input: ProposeRoundInput): ProposeRoundResult {
  if (!input.variants || input.variants.length === 0) {
    throw new IterationError("EMPTY_VARIANTS", "propose_round requires at least 1 variant");
  }
  const meta = getNoteMeta(input.note_id);
  if (!meta) throw new IterationError("NOT_FOUND", `note not found: ${input.note_id}`);
  if (meta.type !== "iteration") {
    throw new IterationError("WRONG_TYPE", `note ${input.note_id} is not an iteration note (type=${meta.type})`);
  }
  if (meta.is_final) {
    throw new IterationError("FINALIZED", `iteration note ${input.note_id} is finalized; create a new one to continue`);
  }
  const state = getIterationState(input.note_id);
  if (!state) throw new IterationError("STATE_FAILED", "failed to compute iteration state");

  // Determine the new round number + validate parent.
  let nextRound = 1;
  let expectedParent: string | null = null;
  if (state.rounds.length > 0) {
    // Previous round must be picked before we open a new one.
    const last = state.rounds[state.rounds.length - 1]!;
    if (last.picked_variant_id === null) {
      throw new IterationError(
        "ROUND_OPEN",
        `round ${last.round} is open — pick a variant before proposing round ${last.round + 1}`
      );
    }
    nextRound = last.round + 1;
    expectedParent = last.picked_variant_id;
  }
  const parent = input.parent_variant_id ?? null;
  if (parent !== expectedParent) {
    throw new IterationError(
      "PARENT_MISMATCH",
      `parent_variant_id should be ${expectedParent === null ? "null (this is round 1)" : `'${expectedParent}'`}; got ${parent === null ? "null" : `'${parent}'`}`
    );
  }

  // Append each variant as a live entry. assertCanAppend (owner-locked) is
  // skipped here because iteration notes have no owner_device_id ownership
  // concept — the operator/agent that owns the note appends.
  const jsonl = entriesPath(join(folioRoot(), meta.path));
  if (!existsSync(dirname(jsonl))) mkdirSync(dirname(jsonl), { recursive: true });

  const tags = [tag(TAG_KIND, "variant"), tag(TAG_ROUND, nextRound)];
  if (parent) tags.push(tag(TAG_PARENT, parent));

  const variantIds: string[] = [];
  for (const v of input.variants) {
    const result = appendEntry(jsonl, {
      content_html: v.content_html,
      tags: [...tags],
      source_ref: v.label ?? undefined,
    });
    variantIds.push(result.entry.id);
  }
  updateLastEntryAt(input.note_id, new Date().toISOString());

  // Fan out the latest variant to SSE subscribers so the viewer re-renders.
  try {
    const { publish } = require("./sse-hub") as typeof import("./sse-hub");
    publish(input.note_id, jsonl);
  } catch {}

  return { round: nextRound, variant_ids: variantIds };
}

export interface PickVariantInput {
  note_id: string;
  variant_id: string;
}

export interface PickVariantResult {
  round: number;
  variant_id: string;
  rejected_variant_ids: string[];
}

/**
 * Mark a variant as picked. Appends a pick event referencing the winner;
 * the renderer computes rejection for siblings on read.
 */
export function pickVariant(input: PickVariantInput): PickVariantResult {
  const meta = getNoteMeta(input.note_id);
  if (!meta) throw new IterationError("NOT_FOUND", `note not found: ${input.note_id}`);
  if (meta.type !== "iteration") {
    throw new IterationError("WRONG_TYPE", `note ${input.note_id} is not an iteration note (type=${meta.type})`);
  }
  if (meta.is_final) {
    throw new IterationError("FINALIZED", `iteration note ${input.note_id} is finalized`);
  }
  const state = getIterationState(input.note_id);
  if (!state) throw new IterationError("STATE_FAILED", "failed to compute iteration state");
  if (!state.current_round) {
    throw new IterationError("NO_OPEN_ROUND", "no open round — call propose_round first");
  }
  const variant = state.current_round.variants.find((v) => v.id === input.variant_id);
  if (!variant) {
    throw new IterationError(
      "UNKNOWN_VARIANT",
      `variant ${input.variant_id} not found in current round (${state.current_round.round}); known ids: ${state.current_round.variants.map((v) => v.id).join(", ")}`
    );
  }

  const jsonl = entriesPath(join(folioRoot(), meta.path));
  appendEntry(jsonl, {
    content_html: "",
    tags: [tag(TAG_KIND, "pick"), tag(TAG_ROUND, state.current_round.round)],
    refs: [input.variant_id],
  });
  updateLastEntryAt(input.note_id, new Date().toISOString());

  try {
    const { publish } = require("./sse-hub") as typeof import("./sse-hub");
    publish(input.note_id, jsonl);
  } catch {}

  const rejected = state.current_round.variants
    .filter((v) => v.id !== input.variant_id)
    .map((v) => v.id);
  return { round: state.current_round.round, variant_id: input.variant_id, rejected_variant_ids: rejected };
}

// ───────────────────────────────────────────────────────────────────────
// wait_for_pick (v0.19.1+) — MCP long-poll for iteration picks.
//
// Replaces the manual "agent waits for user to type 'kliknąłem' in chat"
// seam with a synchronous tool call. Agent calls waitForPick after
// propose_round; this subscribes to the SSE hub for the note's JSONL
// substrate, races against a timeout, and resolves with the variant_id
// when a kind:pick entry lands (or {picked: false, timeout: true} if
// nothing happens before the deadline).
//
// Race-window safeguard: before subscribing, we check current state. If
// the round agent's asking about (for_round) was ALREADY picked between
// propose_round returning and waitForPick getting called, we return
// immediately. Without this, fast users could leave the agent stuck.
// ───────────────────────────────────────────────────────────────────────

export interface WaitForPickResult {
  picked: boolean;
  variant_id?: string;
  round?: number;
  /** True if the timeout fired before any pick arrived. */
  timeout?: boolean;
  /** Open round number when the timeout fired (null if no round was open). */
  current_round?: number | null;
}

const WAIT_TIMEOUT_MIN_MS = 1000;
const WAIT_TIMEOUT_MAX_MS = 300_000;
const WAIT_TIMEOUT_DEFAULT_MS = 60_000;

function clampTimeoutMs(seconds: number | undefined): number {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return WAIT_TIMEOUT_DEFAULT_MS;
  const ms = seconds * 1000;
  if (ms < WAIT_TIMEOUT_MIN_MS) return WAIT_TIMEOUT_MIN_MS;
  if (ms > WAIT_TIMEOUT_MAX_MS) return WAIT_TIMEOUT_MAX_MS;
  return ms;
}

export async function waitForPick(input: {
  note_id: string;
  for_round?: number;
  timeout_s?: number;
}): Promise<WaitForPickResult> {
  const meta = getNoteMeta(input.note_id);
  if (!meta) throw new IterationError("NOT_FOUND", `note not found: ${input.note_id}`);
  if (meta.type !== "iteration") {
    throw new IterationError("WRONG_TYPE", `note ${input.note_id} is not an iteration note (type=${meta.type})`);
  }

  // Fast paths — return without subscribing when there's nothing to wait
  // for. Finalize archives the JSONL to .trash, so lineage isn't reachable
  // through this API after finalize. Agent should switch to reading the
  // compiled body_html (or call iteration_state — also returns empty
  // lineage but is_finalized=true). We return picked:false here as a
  // signal "stop waiting, the note is done".
  const initial = getIterationState(input.note_id);
  if (initial?.is_finalized) {
    return { picked: false, current_round: null };
  }
  if (input.for_round !== undefined && initial) {
    const round = initial.rounds.find((r) => r.round === input.for_round);
    if (round?.picked_variant_id) {
      return { picked: true, variant_id: round.picked_variant_id, round: round.round };
    }
  }

  const jsonl = entriesPath(join(folioRoot(), meta.path));
  const timeoutMs = clampTimeoutMs(input.timeout_s);

  return new Promise<WaitForPickResult>((resolve) => {
    let unsubscribe: (() => void) | null = null;
    let settled = false;

    const finish = (result: WaitForPickResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (unsubscribe) unsubscribe();
      resolve(result);
    };

    const timer = setTimeout(() => {
      const snap = getIterationState(input.note_id);
      finish({
        picked: false,
        timeout: true,
        current_round: snap?.current_round?.round ?? null,
      });
    }, timeoutMs);

    unsubscribe = subscribe(input.note_id, jsonl, (entry: LiveEntry) => {
      // Only kind:pick entries trigger; variants and other tag-mutations ignored.
      if (!entry.tags || !entry.tags.includes(TAG_KIND + "pick")) return;
      const roundTag = entry.tags.find((t) => t.startsWith(TAG_ROUND));
      const round = roundTag ? Number(roundTag.slice(TAG_ROUND.length)) : null;
      if (input.for_round !== undefined && round !== input.for_round) return;
      const variantId = entry.refs && entry.refs.length > 0 ? entry.refs[0] : null;
      if (!variantId) return;
      finish({ picked: true, variant_id: variantId, round: round ?? undefined });
    });
  });
}
