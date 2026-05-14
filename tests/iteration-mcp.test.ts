/**
 * MCP integration for iteration tools — propose_round, pick_variant,
 * iteration_state. Mirrors live-mcp.test.ts pattern: spin up the MCP
 * server in-process, call tools, assert payloads.
 */

import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDb } from "../src/core/db";

let homeDir: string;
let server: any;

async function listTools() {
  const handler = server._requestHandlers.get("tools/list");
  return await handler({ method: "tools/list", params: {} });
}
async function callTool(name: string, args: any) {
  const handler = server._requestHandlers.get("tools/call");
  return await handler({ method: "tools/call", params: { name, arguments: args } });
}

beforeEach(async () => {
  homeDir = mkdtempSync(join(tmpdir(), "folio-iter-mcp-"));
  process.env.FOLIO_HOME = homeDir;
  const { init } = await import("../src/cli/commands/init");
  await init();
  const { buildServer } = await import("../src/mcp/server");
  server = await buildServer();
});

afterEach(() => {
  closeDb();
  rmSync(homeDir, { recursive: true, force: true });
  delete process.env.FOLIO_HOME;
});

test("MCP advertises propose_round / pick_variant / iteration_state", async () => {
  const res = await listTools();
  const names = res.tools.map((t: any) => t.name);
  expect(names).toContain("propose_round");
  expect(names).toContain("pick_variant");
  expect(names).toContain("iteration_state");
});

test("end-to-end via MCP: create iteration note, propose 3 variants, pick one, propose round 2", async () => {
  // Create iteration note (minimal body OK).
  const create = await callTool("create", {
    type: "iteration",
    title: "Landing-page iteration",
    body_html: "<h1>Landing</h1><p>Iterating on hero.</p>",
    thread_id: "iter-mcp",
  });
  expect(create.isError).toBeFalsy();
  const note = JSON.parse(create.content[0].text);
  expect(note.id).toBeTruthy();

  // Round 1: propose 3 variants.
  const r1 = await callTool("propose_round", {
    note_id: note.id,
    variants: [
      { content_html: "<div>Layout A</div>", label: "sidebar-L" },
      { content_html: "<div>Layout B</div>", label: "topnav-3" },
      { content_html: "<div>Layout C</div>", label: "editorial" },
    ],
  });
  expect(r1.isError).toBeFalsy();
  const r1d = JSON.parse(r1.content[0].text);
  expect(r1d.round).toBe(1);
  expect(r1d.variant_ids).toHaveLength(3);

  // iteration_state surfaces current round.
  const state1 = JSON.parse((await callTool("iteration_state", { note_id: note.id })).content[0].text);
  expect(state1.current_round.round).toBe(1);
  expect(state1.current_round.variants).toHaveLength(3);
  expect(state1.lineage).toHaveLength(0);

  // Pick the second one.
  const winnerId = r1d.variant_ids[1];
  const pick = await callTool("pick_variant", { note_id: note.id, variant_id: winnerId });
  expect(pick.isError).toBeFalsy();
  const pd = JSON.parse(pick.content[0].text);
  expect(pd.round).toBe(1);
  expect(pd.variant_id).toBe(winnerId);
  expect(pd.rejected_variant_ids).toHaveLength(2);

  // Round 2 with correct parent.
  const r2 = await callTool("propose_round", {
    note_id: note.id,
    variants: [{ content_html: "<div>B-v1</div>" }, { content_html: "<div>B-v2</div>" }],
    parent_variant_id: winnerId,
  });
  expect(r2.isError).toBeFalsy();
  const r2d = JSON.parse(r2.content[0].text);
  expect(r2d.round).toBe(2);

  const finalState = JSON.parse((await callTool("iteration_state", { note_id: note.id })).content[0].text);
  expect(finalState.rounds).toHaveLength(2);
  expect(finalState.lineage).toHaveLength(1);
  expect(finalState.lineage[0].id).toBe(winnerId);
  expect(finalState.current_round.round).toBe(2);
});

test("propose_round on non-iteration note returns error", async () => {
  const note = JSON.parse((await callTool("create", {
    type: "snippet",
    title: "Not an iteration",
    body_html: "<p>x</p>",
    thread_id: "not-iter",
  })).content[0].text);
  const r = await callTool("propose_round", {
    note_id: note.id,
    variants: [{ content_html: "<div>x</div>" }],
  });
  expect(r.isError).toBeTruthy();
  expect(r.content[0].text).toMatch(/not an iteration|WRONG_TYPE/);
});

test("pick_variant before any round returns error", async () => {
  const note = JSON.parse((await callTool("create", {
    type: "iteration",
    title: "Empty iteration",
    body_html: "<h1>x</h1>",
    thread_id: "empty-iter",
  })).content[0].text);
  const r = await callTool("pick_variant", { note_id: note.id, variant_id: "anything" });
  expect(r.isError).toBeTruthy();
  expect(r.content[0].text).toMatch(/no open round|NO_OPEN_ROUND/);
});

test("iteration_state on unknown note returns error", async () => {
  const r = await callTool("iteration_state", { note_id: "01HXNONEXISTENT" });
  expect(r.isError).toBeTruthy();
});

test("create(type:iteration) without body_html succeeds (minimal chrome OK)", async () => {
  const r = await callTool("create", {
    type: "iteration",
    title: "Minimal",
    body_html: "",
    thread_id: "minimal-iter",
  });
  expect(r.isError).toBeFalsy();
});
