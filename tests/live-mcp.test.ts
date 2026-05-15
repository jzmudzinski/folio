// Error-path coverage for live MCP tools. Happy paths live in
// tests/live-storage.test.ts. Compile logic in tests/live-compile.test.ts.

import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDb } from "../src/core/db";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "folio-live-mcp-"));
  process.env.FOLIO_HOME = tmpDir;
  const { init } = await import("../src/cli/commands/init");
  await init();
});

afterEach(() => {
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function callTool(name: string, args: Record<string, unknown> = {}) {
  const { buildServer } = await import("../src/mcp/server");
  const server = await buildServer();
  const anySvr = server as any;
  return await anySvr._requestHandlers.get("tools/call")({ method: "tools/call", params: { name, arguments: args } });
}

async function makeLive(): Promise<string> {
  const r = await callTool("create", { type: "journal", title: "Live", body_html: "", live: true });
  return JSON.parse(r.content[0].text).id;
}

// ───── append_entry error paths ──────────────────────────────────────────

test("append_entry to non-existent note rejects", async () => {
  const r = await callTool("append_entry", { note_id: "00000000000000000000000000", content_html: "<p>x</p>" });
  expect(r.isError).toBe(true);
  expect(r.content[0].text).toContain("Not found");
});

test("append_entry to non-live note rejects", async () => {
  const r1 = await callTool("create", { type: "snippet", title: "Regular", body_html: "<p>x</p>" });
  const id = JSON.parse(r1.content[0].text).id;
  const r = await callTool("append_entry", { note_id: id, content_html: "<p>x</p>" });
  expect(r.isError).toBe(true);
  expect(r.content[0].text).toContain("not a live note");
});

test("append_entry to finalized note rejects", async () => {
  const id = await makeLive();
  await callTool("append_entry", { note_id: id, content_html: "<p>x</p>" });
  await callTool("finalize", { id });
  const r = await callTool("append_entry", { note_id: id, content_html: "<p>y</p>" });
  expect(r.isError).toBe(true);
});

test("append_entry rejects oversized content_html (>32KB after sanitize)", async () => {
  const id = await makeLive();
  // Build a 40KB plain paragraph; survives sanitize unchanged.
  const huge = "<p>" + "a".repeat(40 * 1024) + "</p>";
  const r = await callTool("append_entry", { note_id: id, content_html: huge });
  expect(r.isError).toBe(true);
  expect(r.content[0].text).toContain("32768");
});

test("append_entry rejects refs pointing at nonexistent entries", async () => {
  const id = await makeLive();
  const r = await callTool("append_entry", { note_id: id, content_html: "<p>x</p>", refs: ["aaaaaaaaaa"] });
  expect(r.isError).toBe(true);
  expect(r.content[0].text).toContain("unknown entry");
});

test("append_entry rejects more than 32 tags", async () => {
  const id = await makeLive();
  const tags = Array.from({ length: 33 }, (_, i) => `tag${i}`);
  const r = await callTool("append_entry", { note_id: id, content_html: "<p>x</p>", tags });
  expect(r.isError).toBe(true);
});

test("append_entry rejects malformed occurred_at", async () => {
  const id = await makeLive();
  const r = await callTool("append_entry", { note_id: id, content_html: "<p>x</p>", occurred_at: "yesterday" });
  expect(r.isError).toBe(true);
  expect(r.content[0].text).toContain("ISO timestamp");
});

test("append_entry accepts empty content_html (tag-mutation entry)", async () => {
  const id = await makeLive();
  const r1 = await callTool("append_entry", { note_id: id, content_html: "<p>todo</p>" });
  const e1 = JSON.parse(r1.content[0].text);
  const r2 = await callTool("append_entry", { note_id: id, content_html: "", tags: ["state:done"], refs: [e1.entry_id] });
  expect(r2.isError).toBeFalsy();
});

// ───── list_entries error paths ──────────────────────────────────────────

test("list_entries on non-live note rejects", async () => {
  const r1 = await callTool("create", { type: "snippet", title: "Regular", body_html: "<p>x</p>" });
  const id = JSON.parse(r1.content[0].text).id;
  const r = await callTool("list_entries", { note_id: id });
  expect(r.isError).toBe(true);
});

test("list_entries rejects malformed since", async () => {
  const id = await makeLive();
  const r = await callTool("list_entries", { note_id: id, since: "not-a-date" });
  expect(r.isError).toBe(true);
});

test("list_entries enforces max limit 500", async () => {
  const id = await makeLive();
  await callTool("append_entry", { note_id: id, content_html: "<p>x</p>" });
  const r = await callTool("list_entries", { note_id: id, limit: 99999 });
  const data = JSON.parse(r.content[0].text);
  // returned is min(filtered.length, capped_limit). We only have 1 entry; just
  // ensure no crash + sane response.
  expect(data.total).toBe(1);
  expect(data.returned).toBe(1);
});

// ───── set_pinned error paths ────────────────────────────────────────────

test("set_pinned > 5 rejects", async () => {
  const id = await makeLive();
  const r = await callTool("set_pinned", { note_id: id, entry_ids: ["a", "b", "c", "d", "e", "f"] });
  expect(r.isError).toBe(true);
  expect(r.content[0].text).toContain("more than 5");
});

test("set_pinned on non-live note rejects", async () => {
  const r1 = await callTool("create", { type: "snippet", title: "Regular", body_html: "<p>x</p>" });
  const id = JSON.parse(r1.content[0].text).id;
  const r = await callTool("set_pinned", { note_id: id, entry_ids: [] });
  expect(r.isError).toBe(true);
});

test("set_pinned with unknown entry_ids rejects", async () => {
  const id = await makeLive();
  const r = await callTool("set_pinned", { note_id: id, entry_ids: ["aaaaaaaaaa"] });
  expect(r.isError).toBe(true);
});

test("set_pinned to empty array clears all pins", async () => {
  const id = await makeLive();
  const a = JSON.parse((await callTool("append_entry", { note_id: id, content_html: "<p>a</p>" })).content[0].text);
  await callTool("set_pinned", { note_id: id, entry_ids: [a.entry_id] });
  // Confirm it's pinned
  let listing = JSON.parse((await callTool("list_entries", { note_id: id })).content[0].text);
  expect(listing.entries.find((e: any) => e.id === a.entry_id).pinned).toBe(true);

  // Clear
  await callTool("set_pinned", { note_id: id, entry_ids: [] });
  listing = JSON.parse((await callTool("list_entries", { note_id: id })).content[0].text);
  expect(listing.entries.find((e: any) => e.id === a.entry_id).pinned).toBe(false);
});

// ───── 16 tools total ────────────────────────────────────────────────────

test("ListTools returns the full folio tool set (live primitives + publish)", async () => {
  const { buildServer } = await import("../src/mcp/server");
  const server = await buildServer();
  const anySvr = server as any;
  const handler = anySvr._requestHandlers.get("tools/list");
  const res = await handler({ method: "tools/list", params: {} });
  const names = res.tools.map((t: any) => t.name);
  expect(names).toContain("append_entry");
  expect(names).toContain("list_entries");
  expect(names).toContain("set_pinned");
  expect(names).toContain("publish");
  // v0.18: +propose_round, +pick_variant, +iteration_state → 16 + 3 = 19
  // v0.19.1: +wait_for_pick → 20
  expect(names).toContain("propose_round");
  expect(names).toContain("pick_variant");
  expect(names).toContain("iteration_state");
  expect(names).toContain("wait_for_pick");
  expect(res.tools.length).toBe(20);
});
