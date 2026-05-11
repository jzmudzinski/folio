import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDb } from "../src/core/db";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "folio-mcp-test-"));
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
  const handler = anySvr._requestHandlers.get("tools/call");
  if (!handler) throw new Error("CallTool handler not registered");
  return await handler({ method: "tools/call", params: { name, arguments: args } });
}

async function listTools() {
  const { buildServer } = await import("../src/mcp/server");
  const server = await buildServer();
  const anySvr = server as any;
  const handler = anySvr._requestHandlers.get("tools/list");
  return await handler({ method: "tools/list", params: {} });
}

async function listResources() {
  const { buildServer } = await import("../src/mcp/server");
  const server = await buildServer();
  const anySvr = server as any;
  const handler = anySvr._requestHandlers.get("resources/list");
  return await handler({ method: "resources/list", params: {} });
}

async function readResource(uri: string) {
  const { buildServer } = await import("../src/mcp/server");
  const server = await buildServer();
  const anySvr = server as any;
  const handler = anySvr._requestHandlers.get("resources/read");
  return await handler({ method: "resources/read", params: { uri } });
}

test("ListTools returns 10 folio tools", async () => {
  const res = await listTools();
  const names = res.tools.map((t: any) => t.name);
  expect(names).toContain("folio.create");
  expect(names).toContain("folio.get");
  expect(names).toContain("folio.list");
  expect(names).toContain("folio.search");
  expect(names).toContain("folio.finalize");
  expect(names).toContain("folio.suggest_thread");
  expect(names).toContain("folio.list_expiring");
  expect(names).toContain("folio.list_themes");
  expect(names).toContain("folio.export");
  expect(names).toContain("folio.unfinalize");
});

test("folio.export standalone inlines theme CSS", async () => {
  const c = await callTool("folio.create", {
    type: "snippet",
    title: "Export test",
    body_html: "<p>hello</p>",
  });
  const { id } = JSON.parse(c.content[0].text);
  const r = await callTool("folio.export", { id, profile: "standalone" });
  const data = JSON.parse(r.content[0].text);
  expect(data.profile).toBe("standalone");
  expect(data.html).toContain("<style>");
  expect(data.html).not.toMatch(/<link rel="stylesheet" href="\/themes/);
  expect(data.size_kb).toBeGreaterThan(0);
});

test("folio.export hosted keeps the link tag", async () => {
  const c = await callTool("folio.create", { type: "snippet", title: "Hosted", body_html: "<p>x</p>" });
  const { id } = JSON.parse(c.content[0].text);
  const r = await callTool("folio.export", { id, profile: "hosted" });
  const data = JSON.parse(r.content[0].text);
  expect(data.html).toMatch(/<link rel="stylesheet" href="\/themes\/[^"]+\/theme\.css">/);
});

test("folio.unfinalize re-arms expiry on a final note", async () => {
  const c = await callTool("folio.create", {
    type: "snippet",
    title: "Will unfinalize",
    body_html: "<p>x</p>",
    is_final: true,
  });
  const { id } = JSON.parse(c.content[0].text);
  const g1 = await callTool("folio.get", { id, include_body: false });
  const m1 = JSON.parse(g1.content[0].text);
  expect(m1.is_final).toBe(true);
  expect(m1.expires_at).toBeNull();
  const u = await callTool("folio.unfinalize", { id });
  const ud = JSON.parse(u.content[0].text);
  expect(ud.ok).toBe(true);
  const g2 = await callTool("folio.get", { id, include_body: false });
  const m2 = JSON.parse(g2.content[0].text);
  expect(m2.is_final).toBe(false);
  expect(m2.expires_at).toBeTruthy();
});

test("folio.unfinalize on already-non-final is a no-op", async () => {
  const c = await callTool("folio.create", { type: "snippet", title: "Not final", body_html: "<p>x</p>" });
  const { id } = JSON.parse(c.content[0].text);
  const u = await callTool("folio.unfinalize", { id });
  const ud = JSON.parse(u.content[0].text);
  expect(ud.ok).toBe(false);
});

test("ListResources returns built-in resources + thread-per-folder", async () => {
  await callTool("folio.create", { type: "snippet", title: "A", body_html: "<p>a</p>", thread_id: "thread-alpha" });
  await callTool("folio.create", { type: "snippet", title: "B", body_html: "<p>b</p>", thread_id: "thread-beta" });

  const res = await listResources();
  const uris = res.resources.map((r: any) => r.uri);
  expect(uris).toContain("folio://recent");
  expect(uris).toContain("folio://final");
  expect(uris).toContain("folio://expiring");
  expect(uris).toContain("folio://threads");
  expect(uris.some((u: string) => u.startsWith("folio://thread/thread-alpha"))).toBe(true);
  expect(uris.some((u: string) => u.startsWith("folio://thread/thread-beta"))).toBe(true);
});

test("ReadResource folio://recent returns recent notes", async () => {
  await callTool("folio.create", { type: "snippet", title: "Recent A", body_html: "<p>a</p>" });
  const r = await readResource("folio://recent");
  const data = JSON.parse(r.contents[0].text);
  expect(Array.isArray(data)).toBe(true);
  expect(data.length).toBeGreaterThanOrEqual(1);
  expect(data[0]).toHaveProperty("title");
});

test("ReadResource folio://thread/<id> returns thread notes", async () => {
  await callTool("folio.create", { type: "snippet", title: "Note 1", body_html: "<p>1</p>", thread_id: "test-thread-r" });
  await callTool("folio.create", { type: "snippet", title: "Note 2", body_html: "<p>2</p>", thread_id: "test-thread-r" });
  const r = await readResource("folio://thread/test-thread-r");
  const data = JSON.parse(r.contents[0].text);
  expect(data.thread_id).toBe("test-thread-r");
  expect(data.count).toBe(2);
  expect(data.notes.length).toBe(2);
});

test("folio.create returns id + local_url", async () => {
  const res = await callTool("folio.create", {
    type: "research",
    title: "Test Research",
    body_html: "<p class='lead'>Quick test.</p><h3>TL;DR</h3><p>It works.</p>",
    thread_id: "test-thread",
  });
  expect(res.isError).toBeFalsy();
  const data = JSON.parse(res.content[0].text);
  expect(data.id).toMatch(/^[0-9A-Z]{26}$/);
  expect(data.local_url).toContain("/n/");
  expect(data.thread_id).toBe("test-thread");
});

test("folio.create rejects invalid type", async () => {
  const res = await callTool("folio.create", {
    type: "invalid",
    title: "x",
    body_html: "<p>x</p>",
  });
  expect(res.isError).toBe(true);
});

test("folio.search after create finds the note", async () => {
  await callTool("folio.create", {
    type: "research",
    title: "Embeddings comparison",
    body_html: "<p>RAG via OpenAI ada-3 vs Voyage AI vs lokalny gte-small.</p>",
    thread_id: "embeddings",
  });
  const res = await callTool("folio.search", { query: "ada" });
  const hits = JSON.parse(res.content[0].text);
  expect(hits.length).toBeGreaterThanOrEqual(1);
  expect(hits[0].snippet).toContain("<mark>");
});

test("folio.suggest_thread returns proposed slug when no match", async () => {
  const res = await callTool("folio.suggest_thread", { title: "Brand new topic" });
  const data = JSON.parse(res.content[0].text);
  expect(data.matches).toEqual([]);
  expect(data.proposed_new_thread).toBe("brand-new-topic");
});

test("folio.suggest_thread returns existing thread when title matches", async () => {
  await callTool("folio.create", {
    type: "research",
    title: "RAG vs Fine-Tuning",
    body_html: "<p>x</p>",
    thread_id: "rag-vs-finetuning",
  });
  // AND across tokens: use a query whose every word appears in the title.
  const res = await callTool("folio.suggest_thread", { title: "RAG Fine-Tuning" });
  const data = JSON.parse(res.content[0].text);
  expect(data.matches?.length).toBeGreaterThanOrEqual(1);
  expect(data.matches[0].thread_id).toBe("rag-vs-finetuning");
});

test("folio.list_themes shows linen as default", async () => {
  const res = await callTool("folio.list_themes", {});
  const data = JSON.parse(res.content[0].text);
  expect(data.default).toBe("linen");
  const names = data.themes.map((t: any) => t.name);
  expect(names).toContain("linen");
  expect(names).toContain("folio");
});

test("folio.finalize clears expiry; folio.list_expiring excludes it", async () => {
  const created = await callTool("folio.create", {
    type: "snippet",
    title: "About to expire",
    body_html: "<p>x</p>",
  });
  const { id } = JSON.parse(created.content[0].text);

  // Simulate "near expiry" by NOT finalizing; default expiry is 30d so within 7d filter returns nothing
  // Make sure the API works at least syntactically:
  const expiring = await callTool("folio.list_expiring", { within_days: 60 });
  const arr = JSON.parse(expiring.content[0].text);
  expect(Array.isArray(arr)).toBe(true);

  // Finalize and re-check
  await callTool("folio.finalize", { id });
  const expiring2 = await callTool("folio.list_expiring", { within_days: 60 });
  const arr2 = JSON.parse(expiring2.content[0].text);
  const foundFinalized = arr2.find((n: any) => n.id === id);
  expect(foundFinalized).toBeUndefined();
});

test("folio.get with include_body=true returns body_html", async () => {
  const created = await callTool("folio.create", {
    type: "snippet",
    title: "Get me",
    body_html: "<p>Hello there from agent</p>",
  });
  const { id } = JSON.parse(created.content[0].text);
  const got = await callTool("folio.get", { id });
  const data = JSON.parse(got.content[0].text);
  expect(data.title).toBe("Get me");
  expect(data.body_html).toContain("Hello there");
});
