/**
 * Viewer share UI proxy tests (v0.19+).
 *
 *   ✓ Unpaired: POST /api/notes/:id/shares → 412 NOT_PAIRED
 *   ✓ Unpaired: GET  /api/notes/:id/shares → 200 with paired:false, shares:[]
 *   ✓ Unpaired: DELETE /api/notes/:id/shares/:token → 412 NOT_PAIRED
 *   ✓ Paired: POST proxies to mock cloud /v1/share and returns its payload
 *   ✓ Paired: GET  proxies to mock cloud /v1/shares?scope_id=…
 *   ✓ Paired: DELETE proxies to cloud /v1/share/:token
 *   ✓ Note page renders the topbar "↗ Share" trigger + popover scaffolding
 *   ✓ /n/:id/shares renders the manage page (empty + populated)
 *
 * Paired flow runs against an in-process mock cloud — small Bun.serve that
 * mimics the three /v1/share endpoints. Sync-state file points at that
 * mock's address. No real network calls.
 */

import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDb } from "../src/core/db";

let homeDir: string;
let viewer: { stop: () => void; port: number; hostname: string } | null = null;
let viewerUrl = "";
let mockCloud: { stop: () => void; port: number; hostname: string; recv: any[] } | null = null;
let mockCloudUrl = "";

function startMockCloud(): { stop: () => void; port: number; hostname: string; recv: any[] } {
  const recv: any[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req): Promise<Response> {
      const u = new URL(req.url);
      // Auth check — every request must have a Bearer token.
      const auth = req.headers.get("authorization") ?? "";
      if (!auth.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
      }
      if (req.method === "POST" && u.pathname === "/v1/share") {
        const body = await req.json() as any;
        recv.push({ method: "POST", path: u.pathname, body });
        return new Response(JSON.stringify({
          token: "mock-token-" + (recv.length),
          url: `${mockCloudUrl}/p/mock-token-${recv.length}/n/${body.scope_id}`,
          expires_at: body.expires_in_days === 0 ? null : new Date(Date.now() + body.expires_in_days * 86400000).toISOString(),
          max_views: body.max_views ?? null,
        }), { headers: { "content-type": "application/json" } });
      }
      if (req.method === "GET" && u.pathname === "/v1/shares") {
        recv.push({ method: "GET", path: u.pathname, scope_id: u.searchParams.get("scope_id") });
        return new Response(JSON.stringify({
          shares: [
            {
              token: "mock-token-1",
              url: `${mockCloudUrl}/p/mock-token-1/n/some-uuid`,
              scope_type: "note",
              scope_id: u.searchParams.get("scope_id"),
              created_at: "2026-05-15T07:00:00Z",
              expires_at: "2026-05-22T07:00:00Z",
              max_views: 5,
              view_count: 2,
            },
          ],
        }), { headers: { "content-type": "application/json" } });
      }
      const delMatch = u.pathname.match(/^\/v1\/share\/([A-Za-z0-9_\-]+)$/);
      if (req.method === "DELETE" && delMatch) {
        recv.push({ method: "DELETE", path: u.pathname, token: delMatch[1] });
        return new Response(JSON.stringify({ revoked: delMatch[1] }), { headers: { "content-type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { stop: () => server.stop(), port: server.port, hostname: server.hostname, recv };
}

async function bootViewer(): Promise<void> {
  const { init } = await import("../src/cli/commands/init");
  await init();
  const cfgPath = join(homeDir, "folio.config.json");
  const parsed = JSON.parse(readFileSync(cfgPath, "utf-8"));
  parsed.viewer_port = 0;
  writeFileSync(cfgPath, JSON.stringify(parsed));
  const { startServer } = await import("../src/viewer/server");
  viewer = (await startServer()) as any;
  viewerUrl = `http://${viewer!.hostname}:${viewer!.port}`;
}

function writeSyncState(remote: string): void {
  const state = {
    remote,
    device_token: "test-token-abc",
    last_pulled_seq: 0,
    last_pushed_at: null,
    last_live_pushed: {},
  };
  writeFileSync(join(homeDir, ".sync-state.json"), JSON.stringify(state));
}

beforeEach(async () => {
  homeDir = mkdtempSync(join(tmpdir(), "folio-viewer-shares-"));
  process.env.FOLIO_HOME = homeDir;
});

afterEach(() => {
  try { viewer?.stop(); } catch {}
  try { mockCloud?.stop(); } catch {}
  viewer = null;
  mockCloud = null;
  closeDb();
  rmSync(homeDir, { recursive: true, force: true });
  delete process.env.FOLIO_HOME;
});

async function makeNote(): Promise<string> {
  const { createNote } = await import("../src/core/storage");
  const note = await createNote({
    type: "snippet",
    title: "Test note",
    body_html: "<p>x</p>",
    thread_id: "shares-test",
    theme: "linen",
  });
  return note.id;
}

// ───── Unpaired states ─────────────────────────────────────────────────

test("POST /api/notes/:id/shares without sync-state → 412 NOT_PAIRED", async () => {
  await bootViewer();
  const id = await makeNote();
  const r = await fetch(`${viewerUrl}/api/notes/${id}/shares`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expires_in_days: 7 }),
  });
  expect(r.status).toBe(412);
  const data = await r.json() as any;
  expect(data.code).toBe("NOT_PAIRED");
});

test("GET /api/notes/:id/shares without sync-state → 200 with paired:false", async () => {
  await bootViewer();
  const id = await makeNote();
  const r = await fetch(`${viewerUrl}/api/notes/${id}/shares`);
  expect(r.status).toBe(200);
  const data = await r.json() as any;
  expect(data.paired).toBe(false);
  expect(data.shares).toEqual([]);
});

test("DELETE /api/notes/:id/shares/:token without sync-state → 412 NOT_PAIRED", async () => {
  await bootViewer();
  const id = await makeNote();
  const r = await fetch(`${viewerUrl}/api/notes/${id}/shares/some-token`, { method: "DELETE" });
  expect(r.status).toBe(412);
});

// ───── Paired flow (mock cloud) ─────────────────────────────────────────

test("POST share → proxies to cloud and returns payload", async () => {
  await bootViewer();
  mockCloud = startMockCloud();
  mockCloudUrl = `http://${mockCloud.hostname}:${mockCloud.port}`;
  writeSyncState(mockCloudUrl);
  const id = await makeNote();

  const r = await fetch(`${viewerUrl}/api/notes/${id}/shares`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expires_in_days: 14, max_views: 5 }),
  });
  expect(r.status).toBe(200);
  const data = await r.json() as any;
  expect(data.token).toBe("mock-token-1");
  expect(data.url).toContain(id);
  expect(data.max_views).toBe(5);

  // Mock cloud received the call with expected body shape.
  expect(mockCloud.recv).toHaveLength(1);
  expect(mockCloud.recv[0].method).toBe("POST");
  expect(mockCloud.recv[0].body.scope_type).toBe("note");
  expect(mockCloud.recv[0].body.scope_id).toBe(id);
  expect(mockCloud.recv[0].body.expires_in_days).toBe(14);
});

test("POST share with recipient → hashes locally + sends both fields to cloud", async () => {
  await bootViewer();
  mockCloud = startMockCloud();
  mockCloudUrl = `http://${mockCloud.hostname}:${mockCloud.port}`;
  writeSyncState(mockCloudUrl);
  const id = await makeNote();

  const r = await fetch(`${viewerUrl}/api/notes/${id}/shares`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expires_in_days: 7, recipient: "Alice@Example.COM " }),
  });
  expect(r.status).toBe(200);
  // Hash is SHA-256 of lowercased+trimmed email; both fields forwarded.
  expect(mockCloud!.recv[0].body.recipient_email).toBe("alice@example.com");
  expect(mockCloud!.recv[0].body.recipient_email_hash).toMatch(/^[a-f0-9]{64}$/);
});

test("GET shares → proxies to cloud list", async () => {
  await bootViewer();
  mockCloud = startMockCloud();
  mockCloudUrl = `http://${mockCloud.hostname}:${mockCloud.port}`;
  writeSyncState(mockCloudUrl);
  const id = await makeNote();

  const r = await fetch(`${viewerUrl}/api/notes/${id}/shares`);
  expect(r.status).toBe(200);
  const data = await r.json() as any;
  expect(data.paired).toBe(true);
  expect(data.shares).toHaveLength(1);
  expect(data.shares[0].token).toBe("mock-token-1");
  expect(mockCloud.recv[0].method).toBe("GET");
  expect(mockCloud.recv[0].scope_id).toBe(id);
});

test("DELETE share → proxies to cloud revoke", async () => {
  await bootViewer();
  mockCloud = startMockCloud();
  mockCloudUrl = `http://${mockCloud.hostname}:${mockCloud.port}`;
  writeSyncState(mockCloudUrl);
  const id = await makeNote();

  const r = await fetch(`${viewerUrl}/api/notes/${id}/shares/mock-token-1`, { method: "DELETE" });
  expect(r.status).toBe(200);
  const data = await r.json() as any;
  expect(data.revoked).toBe("mock-token-1");
  expect(mockCloud.recv[0].method).toBe("DELETE");
  expect(mockCloud.recv[0].token).toBe("mock-token-1");
});

// ───── UI markup ────────────────────────────────────────────────────────

test("note page emits Share trigger (now in sidebar, v0.21.1+) + popover scaffolding", async () => {
  await bootViewer();
  const id = await makeNote();
  const r = await fetch(`${viewerUrl}/n/${id}`);
  expect(r.status).toBe(200);
  const html = await r.text();
  // Trigger sits in the side-aux list (moved from topbar in v0.21.1).
  expect(html).toContain('id="share-trigger"');
  expect(html).toContain('class="active-dot"');
  // The id is rendered inside the .side-aux <nav> block, not in the topbar.
  expect(html).toMatch(/<nav class="side-aux">[\s\S]*id="share-trigger"[\s\S]*<\/nav>/);
  // Popover scaffolding present (unchanged from v0.19/v0.20).
  expect(html).toContain('id="share-pop"');
  expect(html).toContain('id="share-form"');
  expect(html).toContain('id="share-manage"');
  expect(html).toContain('id="share-expires"');
  expect(html).toContain('id="share-maxviews"');
  expect(html).toContain('id="share-recipient"');
});

test("v0.21.1: Share trigger no longer in topbar nav", async () => {
  await bootViewer();
  const id = await makeNote();
  const r = await fetch(`${viewerUrl}/n/${id}`);
  const html = await r.text();
  // Extract the v-nav block specifically (greedy regex would span across
  // the v-nav close into the side-aux block where share-trigger DOES live).
  const navMatch = html.match(/<nav class="v-nav">([\s\S]*?)<\/nav>/);
  expect(navMatch).not.toBeNull();
  expect(navMatch![1]).not.toContain("share-trigger");
  expect(navMatch![1]).not.toContain("v-share-trigger");
});

test("v0.21.1: Hand off to agent button present in sidebar + carries note metadata via data-* attrs", async () => {
  await bootViewer();
  const id = await makeNote();
  const r = await fetch(`${viewerUrl}/n/${id}`);
  const html = await r.text();
  expect(html).toContain('id="folio-handoff-btn"');
  expect(html).toContain('↗ Hand off to agent');
  // Metadata attrs the click handler reads to build the clipboard payload.
  expect(html).toContain(`data-note-id="${id}"`);
  expect(html).toContain('data-note-title="Test note"');
  expect(html).toContain('data-thread-id="shares-test"');
  expect(html).toContain('data-note-type="snippet"');
});

test("v0.21.2: Share popover JS anchors to the trigger via getBoundingClientRect (not fixed top-right)", async () => {
  await bootViewer();
  const id = await makeNote();
  const r = await fetch(`${viewerUrl}/n/${id}`);
  const html = await r.text();
  // The bootstrap JS must read the trigger's rect and set inline top/left
  // on the popover element — no more hardcoded fixed top-right position.
  expect(html).toContain("positionNearTrigger");
  expect(html).toContain("getBoundingClientRect");
  // CSS variable for the arrow's vertical offset is also set inline.
  expect(html).toContain("--share-pop-arrow-top");
});

test("v0.21.1: Handoff JS handler emits a payload referencing folio.get + URL", async () => {
  await bootViewer();
  const id = await makeNote();
  const r = await fetch(`${viewerUrl}/n/${id}`);
  const html = await r.text();
  // The clipboard payload template strings should be in the inline JS. The
  // escaped backticks in the source render to real backticks in the served
  // HTML once the surrounding template literal expands.
  expect(html).toContain("'Folio note: '");
  expect(html).toContain("'Title: '");
  expect(html).toContain("call `folio.get`");
});

test("/n/:id/shares (unpaired) shows the not-paired hint", async () => {
  await bootViewer();
  const id = await makeNote();
  const r = await fetch(`${viewerUrl}/n/${id}/shares`);
  expect(r.status).toBe(200);
  const html = await r.text();
  expect(html).toContain("Cloud not paired");
  expect(html).toContain('href="/cloud"');
});

test("/n/:id/shares (paired, populated) lists share cards", async () => {
  await bootViewer();
  mockCloud = startMockCloud();
  mockCloudUrl = `http://${mockCloud.hostname}:${mockCloud.port}`;
  writeSyncState(mockCloudUrl);
  const id = await makeNote();

  const r = await fetch(`${viewerUrl}/n/${id}/shares`);
  expect(r.status).toBe(200);
  const html = await r.text();
  expect(html).toContain("Shares ·");
  expect(html).toContain("mock-token-1");
  // Card chrome present.
  expect(html).toContain("share-card__url-text");
  expect(html).toContain("share-card__revoke");
});

test("/n/:id/shares (paired, empty) shows the empty state", async () => {
  await bootViewer();
  // Mock cloud with no shares — override response on the fly via a custom mock.
  const recv: any[] = [];
  const stripped = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch() {
      return new Response(JSON.stringify({ shares: [] }), { headers: { "content-type": "application/json" } });
    },
  });
  mockCloud = { stop: () => stripped.stop(), port: stripped.port, hostname: stripped.hostname, recv };
  mockCloudUrl = `http://${stripped.hostname}:${stripped.port}`;
  writeSyncState(mockCloudUrl);
  const id = await makeNote();

  const r = await fetch(`${viewerUrl}/n/${id}/shares`);
  const html = await r.text();
  expect(html).toContain("No active shares yet");
});
