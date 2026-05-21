// Note classification — the single source of truth for "which mutation
// substrate is this note, and how should it render."
//
// ── The unified model (C-minimal) ─────────────────────────────────────────
//
// Every Folio note is an append-only log of immutable units folded into a
// rendered head. The fold differs by *strategy*, but the shape is the same:
//
//   strategy   │ append unit              │ physical substrate        │ fold
//   ───────────┼──────────────────────────┼───────────────────────────┼──────────────────────
//   document   │ a whole revision (.html) │ superseded_by chain        │ resolveHeadOfChain
//   feed       │ a LiveEntry              │ <slug>.entries.jsonl       │ compileRendered
//   iteration  │ a variant / pick entry   │ <slug>.entries.jsonl       │ computeIterationState
//
// `feed` and `iteration` already share the JSONL substrate + the pure
// compile functions in live.ts / iteration.ts. `document` rides the
// superseded_by chain (see storage.ts resolveHeadOfChain / replaceNote).
// Two physical substrates remain by design — per-revision identity and the
// capability-URL trust contract are preserved. The unification here is
// conceptual + a single dispatch point, not a data migration.
//
// Before this module the classification was implicit boolean logic
// duplicated across storage.ts `finalize()` and render.ts `pageNote()`
// (and flagged in AGENTS.md as a "keep four in sync" hazard). It now lives
// here, named once.

import type { NoteMeta } from "./types";

/** The durable substrate a note belongs to, by its current flags. A live
 *  note that has been finalized has `live=0`, so it classifies as
 *  `document` (its feed was compiled into a static body at finalize). */
export type MutationStrategy = "document" | "feed" | "iteration";

/** The minimal note shape the classifiers read. Structural so callers can
 *  pass a full NoteMeta or a hand-built fixture in tests. */
export type NoteClassInput = Pick<NoteMeta, "type" | "live" | "is_final" | "inline_render">;

/**
 * Classify a note into its mutation substrate.
 *
 * Order matters and mirrors storage.ts `finalize()` exactly: the `live`
 * flag is checked before `type`, so a (theoretical) live iteration note is
 * treated as a feed — the same precedence the finalize dispatch has always
 * used. Faithful refactor: do not reorder without changing finalize too.
 */
export function strategyOf(note: NoteClassInput): MutationStrategy {
  if (note.live) return "feed";
  if (note.type === "iteration") return "iteration";
  return "document";
}

/**
 * How the viewer should render a note. Distinct from `strategyOf` because
 * rendering also depends on `is_final`: a finalized feed/iteration note has
 * been compiled into a static body, so it renders as a plain `document`
 * (no live chrome, no gallery auto-refresh).
 *
 * Reproduces render.ts `pageNote()` branching 1:1:
 *   - live  & !final & inline   → live-inline   (entries spliced into body)
 *   - live  & !final & !inline  → live-panel    (side-panel feed)
 *   - iteration & !final        → iteration-gallery
 *   - everything else           → document
 */
export type NoteRenderMode = "document" | "live-panel" | "live-inline" | "iteration-gallery";

export function renderModeOf(note: NoteClassInput): NoteRenderMode {
  if (note.live && !note.is_final) {
    return note.inline_render ? "live-inline" : "live-panel";
  }
  if (note.type === "iteration" && !note.is_final) {
    return "iteration-gallery";
  }
  return "document";
}
