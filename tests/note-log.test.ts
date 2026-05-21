// Pure unit tests on src/core/note-log.ts — the note classification that
// used to be implicit boolean logic duplicated in storage.ts finalize() and
// render.ts pageNote(). No I/O; every test passes a minimal NoteClassInput.

import { expect, test } from "bun:test";
import { strategyOf, renderModeOf, type NoteClassInput } from "../src/core/note-log";

function note(over: Partial<NoteClassInput>): NoteClassInput {
  return {
    type: over.type ?? "research",
    live: over.live ?? false,
    is_final: over.is_final ?? false,
    inline_render: over.inline_render ?? false,
  };
}

// ───── strategyOf ──────────────────────────────────────────────────────────

test("strategyOf: plain note is a document", () => {
  expect(strategyOf(note({ type: "research" }))).toBe("document");
});

test("strategyOf: live note is a feed", () => {
  expect(strategyOf(note({ type: "journal", live: true }))).toBe("feed");
});

test("strategyOf: iteration note is iteration", () => {
  expect(strategyOf(note({ type: "iteration" }))).toBe("iteration");
});

test("strategyOf: live is checked before type (matches finalize order)", () => {
  // A (theoretical) live iteration note routes to the feed substrate, exactly
  // as storage.ts finalize() has always done (live before type).
  expect(strategyOf(note({ type: "iteration", live: true }))).toBe("feed");
});

test("strategyOf: a finalized former-live note (live=0) is a document", () => {
  // finalize() sets live=0 after compiling the feed into a static body.
  expect(strategyOf(note({ type: "journal", live: false, is_final: true }))).toBe("document");
});

test("strategyOf: finalized iteration note still classifies as iteration", () => {
  // strategyOf ignores is_final; iteration notes keep type='iteration'.
  expect(strategyOf(note({ type: "iteration", is_final: true }))).toBe("iteration");
});

// ───── renderModeOf ──────────────────────────────────────────────────────────

test("renderModeOf: static note renders as document", () => {
  expect(renderModeOf(note({ type: "research" }))).toBe("document");
});

test("renderModeOf: active live note without inline → live-panel", () => {
  expect(renderModeOf(note({ live: true, inline_render: false }))).toBe("live-panel");
});

test("renderModeOf: active live note with inline → live-inline", () => {
  expect(renderModeOf(note({ live: true, inline_render: true }))).toBe("live-inline");
});

test("renderModeOf: active iteration note → iteration-gallery", () => {
  expect(renderModeOf(note({ type: "iteration" }))).toBe("iteration-gallery");
});

test("renderModeOf: finalized live note collapses to document", () => {
  // is_final gates off the live chrome even if live were still set.
  expect(renderModeOf(note({ live: true, is_final: true, inline_render: true }))).toBe("document");
});

test("renderModeOf: finalized iteration note collapses to document", () => {
  expect(renderModeOf(note({ type: "iteration", is_final: true }))).toBe("document");
});
