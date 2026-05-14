/**
 * The `plain` theme + the `<style>` tag relaxation that v0.15 enables.
 * Three lightweight checks: theme is discoverable, sanitizer preserves a
 * realistic plain-theme body, the rendered note round-trips through
 * storage with the agent's `<style>` block intact.
 */

import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDb } from "../src/core/db";

let homeDir: string;

beforeEach(async () => {
  homeDir = mkdtempSync(join(tmpdir(), "folio-plain-"));
  process.env.FOLIO_HOME = homeDir;
  const { init } = await import("../src/cli/commands/init");
  await init();
});

afterEach(() => {
  closeDb();
  rmSync(homeDir, { recursive: true, force: true });
  delete process.env.FOLIO_HOME;
});

test("getTheme('plain') returns the bundled theme with css + prompt addendum", async () => {
  const { getTheme } = await import("../src/core/themes");
  const t = await getTheme("plain");
  expect(t).not.toBeNull();
  expect(t!.name).toBe("plain");
  expect(t!.source).toBe("bundled");
  expect(t!.css.length).toBeGreaterThan(500);
  // Plain theme intentionally does NOT define the standard utility classes;
  // the body keeps the page from being a flat white block, that's all. We
  // check for class *selectors*, not the words themselves (the file header
  // comment mentions the absent classes by name).
  expect(t!.css).not.toMatch(/^\.eyebrow\b/m);
  expect(t!.css).not.toMatch(/^\.card\b/m);
  expect(t!.css).not.toMatch(/^\.pill\b/m);
  expect(t!.css).not.toMatch(/^\.verdict\b/m);
  expect(t!.css).not.toMatch(/^\.lead\b/m);
  // Prompt addendum names the contract.
  expect(t!.prompt).toContain("Plain has none");
});

test("listThemes() includes plain", async () => {
  const { listThemes } = await import("../src/core/themes");
  const names = listThemes().map((t) => t.name);
  expect(names).toContain("plain");
});

test("sanitize preserves a realistic plain-theme body_html (<style> + classes)", async () => {
  const { sanitize } = await import("../src/core/sanitize");
  const body = `<style>
    .hero { padding: 60px 0; text-align: center; }
    .hero h1 { font-size: 64px; letter-spacing: -0.04em; margin: 0; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
    @media (prefers-color-scheme: dark) { .hero h1 { color: #f0f0eb; } }
  </style>
  <div class="hero"><h1>The big idea.</h1></div>
  <div class="grid"><div class="cell">One.</div><div class="cell">Two.</div></div>`;
  const r = sanitize(body);
  expect(r.html).toContain("<style");
  expect(r.html).toContain(".hero h1 { font-size: 64px");
  expect(r.html).toContain("@media (prefers-color-scheme: dark)");
  expect(r.html).toContain('class="hero"');
  expect(r.html).toContain('class="grid"');
});

test("createNote with theme='plain' + custom <style> block round-trips through storage", async () => {
  const { createNote, getNoteMeta, readNoteHtml } = await import("../src/core/storage");
  const note = await createNote({
    type: "snippet",
    title: "Plain canvas demo",
    theme: "plain",
    thread_id: "plain-canvas",
    body_html: `<style>
      .stage { background: #0e0e0d; color: #f0f0eb; padding: 80px 40px; border-radius: 12px; text-align: center; }
      .stage h1 { font-family: ui-monospace, monospace; font-size: 48px; margin: 0; letter-spacing: -0.02em; }
      .stage p { color: #8a8a85; margin-top: 12px; }
    </style>
    <div class="stage">
      <h1>plain.</h1>
      <p>own your visual identity.</p>
    </div>`,
  });
  const meta = getNoteMeta(note.id);
  expect(meta?.theme).toBe("plain");
  const html = readNoteHtml(meta!);
  expect(html).toContain("<style");
  expect(html).toContain(".stage h1 { font-family: ui-monospace");
  expect(html).toContain('class="stage"');
});
