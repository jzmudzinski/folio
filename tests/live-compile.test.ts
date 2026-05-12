// Pure unit tests on src/core/live.ts compile logic.
// No I/O — every test constructs LiveEntry[] inline and asserts the
// compiled shape. These cover the spec's three compile guarantees:
//   - Direct refs only (no transitive chain propagation)
//   - Namespace last-write-wins (by ts ascending)
//   - Non-namespaced tag accumulation (set semantics)
// Plus the visibility rule: empty content_html → not rendered.

import { expect, test } from "bun:test";
import {
  compile,
  compileRendered,
  currentPinnedIds,
  parseTag,
  newEntryId,
} from "../src/core/live";
import type { LiveEntry } from "../src/core/types";

function entry(over: Partial<LiveEntry>): LiveEntry {
  return {
    id: over.id ?? "a000000001",
    ts: over.ts ?? "2026-05-12T08:00:00Z",
    content_html: over.content_html ?? "<p>x</p>",
    tags: over.tags ?? [],
    ...(over.refs ? { refs: over.refs } : {}),
    ...(over.occurred_at ? { occurred_at: over.occurred_at } : {}),
    ...(over.importance !== undefined ? { importance: over.importance } : {}),
    ...(over.source_ref ? { source_ref: over.source_ref } : {}),
  };
}

// ───── parseTag ──────────────────────────────────────────────────────────

test("parseTag handles namespace tags", () => {
  expect(parseTag("state:done")).toEqual({ ns: "state", value: "done", raw: "state:done" });
});

test("parseTag handles unnamespaced tags", () => {
  expect(parseTag("urgent")).toEqual({ ns: null, value: "urgent", raw: "urgent" });
});

test("parseTag treats leading colon as unnamespaced", () => {
  expect(parseTag(":weird")).toEqual({ ns: null, value: ":weird", raw: ":weird" });
});

test("parseTag splits only on the first colon (value may contain colons)", () => {
  expect(parseTag("ref:https://example.com")).toEqual({
    ns: "ref",
    value: "https://example.com",
    raw: "ref:https://example.com",
  });
});

// ───── newEntryId ────────────────────────────────────────────────────────

test("newEntryId returns a 10-char lowercase alphanumeric id", () => {
  const id = newEntryId();
  expect(id).toMatch(/^[a-z0-9]{10}$/);
});

test("newEntryId IDs are unique across calls", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 50; i++) ids.add(newEntryId());
  expect(ids.size).toBe(50);
});

// ───── compile: trivial cases ────────────────────────────────────────────

test("compile of one entry with no refs returns it with its own tags", () => {
  const r = compile([entry({ id: "a", tags: ["state:open", "urgent"] })]);
  expect(r).toHaveLength(1);
  expect(r[0]!.id).toBe("a");
  expect(r[0]!.compiled_tags.sort()).toEqual(["state:open", "urgent"].sort());
  expect(r[0]!.state).toBe("open");
  expect(r[0]!.pinned).toBe(false);
  expect(r[0]!.rendered).toBe(true);
});

test("compile of empty content_html marks entry not rendered", () => {
  const r = compile([entry({ id: "a", content_html: "  ", tags: ["state:open"] })]);
  expect(r[0]!.rendered).toBe(false);
});

// ───── compile: chain X→Y direct refs ────────────────────────────────────

test("compile applies follow-up tags to refs target (namespace last-write-wins)", () => {
  const r = compile([
    entry({ id: "a", ts: "2026-05-12T08:00:00Z", tags: ["state:open"] }),
    entry({ id: "b", ts: "2026-05-12T09:00:00Z", refs: ["a"], tags: ["state:done"] }),
  ]);
  const a = r.find((c) => c.id === "a")!;
  const b = r.find((c) => c.id === "b")!;
  expect(a.state).toBe("done"); // overridden by b
  expect(b.state).toBe("done"); // b's own tag
});

test("compile applies multiple follow-ups in ts ascending order", () => {
  const r = compile([
    entry({ id: "a", ts: "2026-05-12T08:00:00Z", tags: ["state:open"] }),
    entry({ id: "c", ts: "2026-05-12T10:00:00Z", refs: ["a"], tags: ["state:cancelled"] }),
    entry({ id: "b", ts: "2026-05-12T09:00:00Z", refs: ["a"], tags: ["state:done"] }),
  ]);
  const a = r.find((c) => c.id === "a")!;
  // b applied before c by ts; c wins last-write-wins.
  expect(a.state).toBe("cancelled");
});

// ───── compile: no transitive propagation ────────────────────────────────

test("compile does NOT propagate transitively (Z→Y→X: Z does not affect X)", () => {
  const r = compile([
    entry({ id: "x", ts: "2026-05-12T08:00:00Z", tags: ["state:open"] }),
    entry({ id: "y", ts: "2026-05-12T09:00:00Z", refs: ["x"], tags: ["state:done"] }),
    entry({ id: "z", ts: "2026-05-12T10:00:00Z", refs: ["y"], tags: ["state:cancelled"] }),
  ]);
  const x = r.find((c) => c.id === "x")!;
  const y = r.find((c) => c.id === "y")!;
  const z = r.find((c) => c.id === "z")!;
  expect(x.state).toBe("done");      // only y affects x
  expect(y.state).toBe("cancelled"); // z affects y
  expect(z.state).toBe("cancelled"); // z's own
});

// ───── compile: non-namespaced tag accumulation ──────────────────────────

test("compile accumulates non-namespaced tags from follow-ups", () => {
  const r = compile([
    entry({ id: "a", ts: "2026-05-12T08:00:00Z", tags: ["urgent"] }),
    entry({ id: "b", ts: "2026-05-12T09:00:00Z", refs: ["a"], tags: ["blocked"] }),
    entry({ id: "c", ts: "2026-05-12T10:00:00Z", refs: ["a"], tags: ["needs-review"] }),
  ]);
  const a = r.find((c) => c.id === "a")!;
  expect(a.compiled_tags.sort()).toEqual(["blocked", "needs-review", "urgent"]);
});

test("compile dedupes identical non-namespaced tags (set semantics)", () => {
  const r = compile([
    entry({ id: "a", ts: "t1", tags: ["urgent"] }),
    entry({ id: "b", ts: "t2", refs: ["a"], tags: ["urgent"] }),
  ]);
  const a = r.find((c) => c.id === "a")!;
  expect(a.compiled_tags).toEqual(["urgent"]);
});

// ───── compile: pin / unpin chain ────────────────────────────────────────

test("compile: view:pinned then view:unpinned → not pinned", () => {
  const r = compile([
    entry({ id: "a", ts: "t1", tags: ["view:pinned"] }),
    entry({ id: "b", ts: "t2", refs: ["a"], tags: ["view:unpinned"] }),
  ]);
  const a = r.find((c) => c.id === "a")!;
  expect(a.pinned).toBe(false);
});

test("compile: pin → unpin → pin (latest in namespace wins)", () => {
  const r = compile([
    entry({ id: "a", ts: "t1", tags: ["view:pinned"] }),
    entry({ id: "b", ts: "t2", refs: ["a"], tags: ["view:unpinned"] }),
    entry({ id: "c", ts: "t3", refs: ["a"], tags: ["view:pinned"] }),
  ]);
  const a = r.find((c) => c.id === "a")!;
  expect(a.pinned).toBe(true);
});

test("compile: only `view:pinned` exact value counts as pinned", () => {
  const r = compile([
    entry({ id: "a", ts: "t1", tags: ["view:hidden"] }),
  ]);
  expect(r[0]!.pinned).toBe(false);
});

// ───── compile: combined namespace + non-namespaced ──────────────────────

test("compile merges both namespace (overwrite) and non-namespaced (accumulate)", () => {
  const r = compile([
    entry({ id: "a", ts: "t1", tags: ["state:open", "urgent"] }),
    entry({ id: "b", ts: "t2", refs: ["a"], tags: ["state:done", "blocked"] }),
  ]);
  const a = r.find((c) => c.id === "a")!;
  expect(a.compiled_tags.sort()).toEqual(["blocked", "state:done", "urgent"]);
  expect(a.state).toBe("done");
});

// ───── compileRendered ───────────────────────────────────────────────────

test("compileRendered filters out empty-content entries", () => {
  const r = compileRendered([
    entry({ id: "a", content_html: "<p>visible</p>", tags: ["state:open"] }),
    entry({ id: "b", content_html: "", refs: ["a"], tags: ["state:done"] }), // pure tag mutation
  ]);
  expect(r).toHaveLength(1);
  expect(r[0]!.id).toBe("a");
  expect(r[0]!.state).toBe("done"); // b's tag-mutation still applied
});

// ───── currentPinnedIds ──────────────────────────────────────────────────

test("currentPinnedIds returns ids of compiled-pinned entries", () => {
  const ids = currentPinnedIds([
    entry({ id: "a", ts: "t1", tags: ["view:pinned"] }),
    entry({ id: "b", ts: "t2", tags: [] }),
    entry({ id: "c", ts: "t3", tags: ["view:pinned"] }),
  ]);
  expect(ids.sort()).toEqual(["a", "c"]);
});

test("currentPinnedIds respects later unpin", () => {
  const ids = currentPinnedIds([
    entry({ id: "a", ts: "t1", tags: ["view:pinned"] }),
    entry({ id: "b", ts: "t2", refs: ["a"], tags: ["view:unpinned"] }),
  ]);
  expect(ids).toEqual([]);
});

// ───── ts sort stability ─────────────────────────────────────────────────

test("compile is stable when entries share ts (preserves insertion order)", () => {
  // Two entries with identical ts; compile sort must not scramble order.
  const r = compile([
    entry({ id: "a", ts: "t1", tags: ["urgent"] }),
    entry({ id: "b", ts: "t1", tags: ["blocked"] }),
  ]);
  expect(r.map((c) => c.id)).toEqual(["a", "b"]);
});
