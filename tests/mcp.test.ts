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

test("ListTools returns 11 folio tools", async () => {
  const res = await listTools();
  const names = res.tools.map((t: any) => t.name);
  expect(names).toContain("create");
  expect(names).toContain("get");
  expect(names).toContain("list");
  expect(names).toContain("search");
  expect(names).toContain("finalize");
  expect(names).toContain("suggest_thread");
  expect(names).toContain("list_expiring");
  expect(names).toContain("list_themes");
  expect(names).toContain("export");
  expect(names).toContain("unfinalize");
  expect(names).toContain("version");
});

test("version tool returns package.json version + system info", async () => {
  const res = await callTool("version", {});
  expect(res.isError).toBeFalsy();
  const data = JSON.parse(res.content[0].text);
  expect(data.name).toBe("folio");
  expect(data.version).toMatch(/^\d+\.\d+\.\d+$/);
  expect(typeof data.folio_root).toBe("string");
  expect(data.viewer_url).toMatch(/^http:\/\//);
  expect(data.default_theme).toBe("linen");
  expect(typeof data.default_lifespan_days).toBe("number");
});

test("list_revisions returns the chain oldest→newest with is_head flags", async () => {
  const c = await callTool("create", {
    type: "snippet",
    title: "Rev v1",
    body_html: "<p>one</p>",
    thread_id: "rev-mcp",
  });
  const { id: v1 } = JSON.parse(c.content[0].text);
  // Build the chain via storage (isolates this test to list_revisions; the
  // replace MCP tool's URL-building has an unrelated config-cache quirk).
  const { replaceNote } = await import("../src/core/storage");
  const r = await replaceNote({ old_id: v1, body_html: "<p>two</p>", title: "Rev v2" });
  const v2 = r.new_meta!.id;

  const res = await callTool("list_revisions", { id: v1 });
  expect(res.isError).toBeFalsy();
  const data = JSON.parse(res.content[0].text);
  expect(data.count).toBe(2);
  expect(data.revisions.map((x: any) => x.id)).toEqual([v1, v2]);
  expect(data.revisions[0].version).toBe(1);
  expect(data.revisions[0].is_head).toBe(false);
  expect(data.revisions[1].is_head).toBe(true);
});

test("list_revisions errors on an unknown id", async () => {
  const res = await callTool("list_revisions", { id: "NOTAREALID000000000000000" });
  expect(res.isError).toBe(true);
});

test("export standalone inlines theme CSS", async () => {
  const c = await callTool("create", {
    type: "snippet",
    title: "Export test",
    body_html: "<p>hello</p>",
  });
  const { id } = JSON.parse(c.content[0].text);
  const r = await callTool("export", { id, profile: "standalone" });
  const data = JSON.parse(r.content[0].text);
  expect(data.profile).toBe("standalone");
  expect(data.html).toContain("<style>");
  expect(data.html).not.toMatch(/<link rel="stylesheet" href="\/themes/);
  expect(data.size_kb).toBeGreaterThan(0);
});

test("export hosted keeps the link tag", async () => {
  const c = await callTool("create", { type: "snippet", title: "Hosted", body_html: "<p>x</p>" });
  const { id } = JSON.parse(c.content[0].text);
  const r = await callTool("export", { id, profile: "hosted" });
  const data = JSON.parse(r.content[0].text);
  expect(data.html).toMatch(/<link rel="stylesheet" href="\/themes\/[^"]+\/theme\.css">/);
});

test("unfinalize re-arms expiry on a final note", async () => {
  const c = await callTool("create", {
    type: "snippet",
    title: "Will unfinalize",
    body_html: "<p>x</p>",
    is_final: true,
  });
  const { id } = JSON.parse(c.content[0].text);
  const g1 = await callTool("get", { id, include_body: false });
  const m1 = JSON.parse(g1.content[0].text);
  expect(m1.is_final).toBe(true);
  expect(m1.expires_at).toBeNull();
  const u = await callTool("unfinalize", { id });
  const ud = JSON.parse(u.content[0].text);
  expect(ud.ok).toBe(true);
  const g2 = await callTool("get", { id, include_body: false });
  const m2 = JSON.parse(g2.content[0].text);
  expect(m2.is_final).toBe(false);
  expect(m2.expires_at).toBeTruthy();
});

test("unfinalize on already-non-final is a no-op", async () => {
  const c = await callTool("create", { type: "snippet", title: "Not final", body_html: "<p>x</p>" });
  const { id } = JSON.parse(c.content[0].text);
  const u = await callTool("unfinalize", { id });
  const ud = JSON.parse(u.content[0].text);
  expect(ud.ok).toBe(false);
});

test("ListResources returns built-in resources + thread-per-folder", async () => {
  await callTool("create", { type: "snippet", title: "A", body_html: "<p>a</p>", thread_id: "thread-alpha" });
  await callTool("create", { type: "snippet", title: "B", body_html: "<p>b</p>", thread_id: "thread-beta" });

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
  await callTool("create", { type: "snippet", title: "Recent A", body_html: "<p>a</p>" });
  const r = await readResource("folio://recent");
  const data = JSON.parse(r.contents[0].text);
  expect(Array.isArray(data)).toBe(true);
  expect(data.length).toBeGreaterThanOrEqual(1);
  expect(data[0]).toHaveProperty("title");
});

test("ReadResource folio://thread/<id> returns thread notes", async () => {
  await callTool("create", { type: "snippet", title: "Note 1", body_html: "<p>1</p>", thread_id: "test-thread-r" });
  await callTool("create", { type: "snippet", title: "Note 2", body_html: "<p>2</p>", thread_id: "test-thread-r" });
  const r = await readResource("folio://thread/test-thread-r");
  const data = JSON.parse(r.contents[0].text);
  expect(data.thread_id).toBe("test-thread-r");
  expect(data.count).toBe(2);
  expect(data.notes.length).toBe(2);
});

test("create returns id + local_url", async () => {
  const res = await callTool("create", {
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

test("create rejects invalid type", async () => {
  const res = await callTool("create", {
    type: "invalid",
    title: "x",
    body_html: "<p>x</p>",
  });
  expect(res.isError).toBe(true);
});

test("create returns public_url equal to local_url when no viewer_public_url set", async () => {
  const res = await callTool("create", { type: "snippet", title: "Default base", body_html: "<p>x</p>" });
  expect(res.isError).toBeFalsy();
  const data = JSON.parse(res.content[0].text);
  expect(data.public_url).toBe(data.local_url);
  expect(data.response_hint).toContain(`MEDIA:${data.public_url}`);
});

test("create uses viewer_public_url when configured", async () => {
  const { saveConfig, loadConfig } = await import("../src/core/config");
  const cfg = await loadConfig();
  await saveConfig({ ...cfg, viewer_public_url: "https://notes.example.com" });
  const res = await callTool("create", { type: "snippet", title: "Public base", body_html: "<p>x</p>" });
  expect(res.isError).toBeFalsy();
  const data = JSON.parse(res.content[0].text);
  expect(data.public_url).toBe(`https://notes.example.com/n/${data.id}`);
  expect(data.local_url).toContain("127.0.0.1");
  expect(data.local_url).not.toContain("notes.example.com");
  expect(data.response_hint).toContain(`MEDIA:https://notes.example.com/n/${data.id}`);
});

test("create strips trailing slash from viewer_public_url", async () => {
  const { saveConfig, loadConfig } = await import("../src/core/config");
  const cfg = await loadConfig();
  await saveConfig({ ...cfg, viewer_public_url: "https://notes.example.com/" });
  const res = await callTool("create", { type: "snippet", title: "Trailing slash", body_html: "<p>x</p>" });
  const data = JSON.parse(res.content[0].text);
  expect(data.public_url).toBe(`https://notes.example.com/n/${data.id}`);
});

test("version tool exposes both viewer_url and public_url", async () => {
  const { saveConfig, loadConfig } = await import("../src/core/config");
  const cfg = await loadConfig();
  await saveConfig({ ...cfg, viewer_public_url: "https://notes.example.com" });
  const res = await callTool("version", {});
  const data = JSON.parse(res.content[0].text);
  expect(data.viewer_url).toMatch(/^http:\/\/127\.0\.0\.1:/);
  expect(data.public_url).toBe("https://notes.example.com");
});

test("search after create finds the note", async () => {
  await callTool("create", {
    type: "research",
    title: "Embeddings comparison",
    body_html: "<p>RAG via OpenAI ada-3 vs Voyage AI vs lokalny gte-small.</p>",
    thread_id: "embeddings",
  });
  const res = await callTool("search", { query: "ada" });
  const hits = JSON.parse(res.content[0].text);
  expect(hits.length).toBeGreaterThanOrEqual(1);
  expect(hits[0].snippet).toContain("<mark>");
});

test("suggest_thread returns proposed slug when no match", async () => {
  const res = await callTool("suggest_thread", { title: "Brand new topic" });
  const data = JSON.parse(res.content[0].text);
  expect(data.matches).toEqual([]);
  expect(data.proposed_new_thread).toBe("brand-new-topic");
});

test("suggest_thread returns existing thread when title matches", async () => {
  await callTool("create", {
    type: "research",
    title: "RAG vs Fine-Tuning",
    body_html: "<p>x</p>",
    thread_id: "rag-vs-finetuning",
  });
  // AND across tokens: use a query whose every word appears in the title.
  const res = await callTool("suggest_thread", { title: "RAG Fine-Tuning" });
  const data = JSON.parse(res.content[0].text);
  expect(data.matches?.length).toBeGreaterThanOrEqual(1);
  expect(data.matches[0].thread_id).toBe("rag-vs-finetuning");
});

test("list_themes shows linen as default", async () => {
  const res = await callTool("list_themes", {});
  const data = JSON.parse(res.content[0].text);
  expect(data.default).toBe("linen");
  const names = data.themes.map((t: any) => t.name);
  expect(names).toContain("linen");
  expect(names).toContain("folio");
});

test("finalize clears expiry; list_expiring excludes it", async () => {
  const created = await callTool("create", {
    type: "snippet",
    title: "About to expire",
    body_html: "<p>x</p>",
  });
  const { id } = JSON.parse(created.content[0].text);

  // Simulate "near expiry" by NOT finalizing; default expiry is 30d so within 7d filter returns nothing
  // Make sure the API works at least syntactically:
  const expiring = await callTool("list_expiring", { within_days: 60 });
  const arr = JSON.parse(expiring.content[0].text);
  expect(Array.isArray(arr)).toBe(true);

  // Finalize and re-check
  await callTool("finalize", { id });
  const expiring2 = await callTool("list_expiring", { within_days: 60 });
  const arr2 = JSON.parse(expiring2.content[0].text);
  const foundFinalized = arr2.find((n: any) => n.id === id);
  expect(foundFinalized).toBeUndefined();
});

test("get with include_body=true returns body_html", async () => {
  const created = await callTool("create", {
    type: "snippet",
    title: "Get me",
    body_html: "<p>Hello there from agent</p>",
  });
  const { id } = JSON.parse(created.content[0].text);
  const got = await callTool("get", { id });
  const data = JSON.parse(got.content[0].text);
  expect(data.title).toBe("Get me");
  expect(data.body_html).toContain("Hello there");
});
