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

test("sanitize permissive mode keeps inline formatting tags that default mode strips", async () => {
  // Reported by an agent generating a custom widget on the plain theme:
  // <b id="x"> was disappearing entirely (not just losing the id), breaking
  // a script that did getElementById('x'). Permissive mode is the contract
  // for plain: agent owns the visual identity, sanitizer steps aside.
  const { sanitize } = await import("../src/core/sanitize");
  const body = `<p>Here is <b id="hl">a bold</b> and <i>italic</i> and <u>underline</u> and <s>strike</s> and <q>quoted</q>.</p>`;
  const strict = sanitize(body);
  const permissive = sanitize(body, { mode: "permissive" });
  // Default mode drops <b>/<i>/<u>/<s>/<q> entirely
  expect(strict.html).not.toContain("<b");
  expect(strict.html).not.toContain("<i>");
  expect(strict.html).not.toContain("<u>");
  expect(strict.html).not.toContain("<s>");
  expect(strict.html).not.toContain("<q>");
  // Permissive keeps them + the id
  expect(permissive.html).toContain('<b id="hl">');
  expect(permissive.html).toContain("<i>");
  expect(permissive.html).toContain("<u>");
  expect(permissive.html).toContain("<s>");
  expect(permissive.html).toContain("<q>");
});

test("sanitize permissive mode strips on*-handlers and javascript: URLs", async () => {
  // The price of permissive: we must actively scrub the escape vectors that
  // the default allowlist's narrow surface ruled out by construction.
  const { sanitize } = await import("../src/core/sanitize");
  const body = `<a href="javascript:alert(1)" onclick="alert(2)">click</a>
    <img src="javascript:evil()" onerror="alert(3)">
    <div onmouseover="alert(4)" data-keep="yes">hi</div>`;
  const r = sanitize(body, { mode: "permissive" });
  expect(r.html).not.toContain("javascript:");
  expect(r.html).not.toMatch(/onclick=/i);
  expect(r.html).not.toMatch(/onerror=/i);
  expect(r.html).not.toMatch(/onmouseover=/i);
  // But data-* + the tags + safe attrs survive
  expect(r.html).toContain('data-keep="yes"');
  expect(r.html).toContain("<a");
  expect(r.html).toContain("<img");
});

test("sanitize permissive mode strips side-effecting head-y tags", async () => {
  // The dangerous ones: <meta http-equiv="refresh"> navigates the iframe,
  // <link rel="stylesheet" href="..."> pulls external CSS, <base href="..."
  // rewrites every relative URL. Drop them with their content. <head> /
  // <html> / <body> wrappers stay (inert in the sandbox); we don't try to
  // unwrap-keep-children because exclusiveFilter drops the subtree.
  const { sanitize } = await import("../src/core/sanitize");
  const body = `<meta http-equiv="refresh" content="0;url=evil">
    <link rel="stylesheet" href="https://evil.test/x.css">
    <base href="https://evil.test/">
    <noscript><img src="https://evil.test/track.gif"></noscript>
    <p>real content</p>`;
  const r = sanitize(body, { mode: "permissive" });
  expect(r.html).not.toMatch(/<meta\b/i);
  expect(r.html).not.toMatch(/<link\b/i);
  expect(r.html).not.toMatch(/<base\b/i);
  expect(r.html).not.toMatch(/<noscript\b/i);
  expect(r.html).not.toContain("evil.test");
  expect(r.html).toContain("<p>real content</p>");
});

test("sanitize permissive mode still enforces iframe sandbox (strips allow-same-origin)", async () => {
  // A nested iframe with allow-same-origin could escape the outer null-origin
  // sandbox. This guarantee must hold in every mode.
  const { sanitize } = await import("../src/core/sanitize");
  const body = `<iframe src="https://example.test/" sandbox="allow-scripts allow-same-origin allow-top-navigation"></iframe>`;
  const r = sanitize(body, { mode: "permissive" });
  expect(r.html).toContain("<iframe");
  expect(r.html).not.toContain("allow-same-origin");
  expect(r.html).toContain("allow-scripts");
});

test("createNote with theme='plain' applies permissive sanitization (round-trip)", async () => {
  // The integration point: storage.createNote() detects theme === 'plain' and
  // passes mode: 'permissive' to sanitize. Verify a <b id="..."> survives end
  // to end through file write + read.
  const { createNote, getNoteMeta, readNoteHtml } = await import("../src/core/storage");
  const note = await createNote({
    type: "snippet",
    title: "Plain b-tag round-trip",
    theme: "plain",
    thread_id: "plain-b-tag",
    body_html: `<p>Counter: <b id="counter">0</b>.</p>
      <script>document.getElementById('counter').textContent = '42';</script>`,
  });
  const meta = getNoteMeta(note.id);
  expect(meta?.theme).toBe("plain");
  const html = readNoteHtml(meta!);
  expect(html).toContain('<b id="counter">');
  expect(html).toContain("<script>");
});

test("createNote with a non-plain theme keeps the strict allowlist (<b> is dropped)", async () => {
  // Regression guard: don't accidentally widen sanitization for every theme.
  const { createNote, getNoteMeta, readNoteHtml } = await import("../src/core/storage");
  const note = await createNote({
    type: "snippet",
    title: "Linen b-tag drop",
    theme: "linen",
    thread_id: "linen-b-tag",
    body_html: `<p>Here is <b>a bold</b> word.</p>`,
  });
  const meta = getNoteMeta(note.id);
  expect(meta?.theme).toBe("linen");
  const html = readNoteHtml(meta!);
  expect(html).not.toContain("<b>");
  expect(html).toContain("a bold");
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
