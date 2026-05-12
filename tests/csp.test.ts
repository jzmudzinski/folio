import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDb } from "../src/core/db";

let tmpDir: string;
let server: { stop: () => void; port: number; hostname: string } | null = null;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "folio-csp-test-"));
  process.env.FOLIO_HOME = tmpDir;
  const { init } = await import("../src/cli/commands/init");
  await init();
  // Force ephemeral port — Bun picks one when port=0
  const cfgPath = join(tmpDir, "folio.config.json");
  const parsed = JSON.parse(readFileSync(cfgPath, "utf-8"));
  parsed.viewer_port = 0;
  writeFileSync(cfgPath, JSON.stringify(parsed));
  const { startServer } = await import("../src/viewer/server");
  server = (await startServer()) as any;
});

afterEach(() => {
  try { server?.stop(); } catch {}
  server = null;
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
});

test("/raw/:id sends strict CSP + sandbox headers", async () => {
  const { createNote } = await import("../src/core/storage");
  const note = await createNote({
    type: "snippet",
    title: "CSP test note",
    body_html: "<p>hello</p>",
  });
  const res = await fetch(`http://${server!.hostname}:${server!.port}/raw/${note.id}`);
  expect(res.status).toBe(200);

  const csp = res.headers.get("content-security-policy") ?? "";
  expect(csp).toContain("connect-src 'none'");
  expect(csp).toContain("frame-ancestors 'self'");
  expect(csp).toMatch(/script-src[^;]*https:/);
  expect(csp).toMatch(/default-src[^;]*'self'/);
  expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  expect(res.headers.get("referrer-policy")).toBe("no-referrer");
});

test("/raw/:id 404 path returns plain text without CSP", async () => {
  const res = await fetch(`http://${server!.hostname}:${server!.port}/raw/nonexistent`);
  expect(res.status).toBe(404);
});
