import { expect, test } from "bun:test";
import { sanitize } from "../src/core/sanitize";

test("preserves inline <script> (v0.3+ allows scripts — note is null-origin sandboxed)", () => {
  const r = sanitize(`<p>ok</p><script>const x = 1; document.body.dataset.x = x;</script>`);
  expect(r.html).toContain("<script");
  expect(r.html).toContain("const x = 1");
  expect(r.html).toContain("<p>ok</p>");
});

test("preserves <script src=https://...> for CDN imports", () => {
  const r = sanitize(`<script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>`);
  expect(r.html).toContain('src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"');
});

test("preserves script attributes type/async/defer/integrity", () => {
  const r = sanitize(`<script type="module" src="https://esm.sh/three" async defer integrity="sha384-foo" crossorigin="anonymous"></script>`);
  expect(r.html).toContain('type="module"');
  expect(r.html).toContain("async");
  expect(r.html).toContain("defer");
  expect(r.html).toContain('integrity="sha384-foo"');
  expect(r.html).toContain('crossorigin="anonymous"');
});

test("blocks script[src=http://...] (https only)", () => {
  const r = sanitize(`<script src="http://insecure.example/x.js"></script>`);
  expect(r.html).not.toContain("http://insecure.example");
});

test("blocks script[src=javascript:...]", () => {
  const r = sanitize(`<script src="javascript:alert(1)"></script>`);
  expect(r.html).not.toContain("javascript:");
});

test("blocks script[src=data:...]", () => {
  const r = sanitize(`<script src="data:text/javascript,alert(1)"></script>`);
  expect(r.html).not.toContain("data:");
});

test("strips on* event handlers", () => {
  const r = sanitize(`<a href="x" onclick="alert(1)">click</a>`);
  expect(r.html).not.toContain("onclick");
});

test("allows <iframe sandbox> and forces safe flags", () => {
  const r = sanitize(`<iframe src="https://example.com/embed" sandbox="allow-scripts" width="600" height="400"></iframe>`);
  expect(r.html).toContain("<iframe");
  expect(r.html).toContain("allow-scripts");
  expect(r.html).toContain('sandbox="allow-scripts"');
  expect(r.html).toContain('src="https://example.com/embed"');
});

test("forces sandbox on iframe with no sandbox attribute", () => {
  const r = sanitize(`<iframe src="https://example.com/x"></iframe>`);
  expect(r.html).toContain("sandbox=");
  expect(r.html).toMatch(/sandbox="[^"]*allow-scripts[^"]*"/);
});

test("strips allow-same-origin from sandbox (escape attempt)", () => {
  const r = sanitize(`<iframe src="https://example.com" sandbox="allow-scripts allow-same-origin"></iframe>`);
  expect(r.html).not.toContain("allow-same-origin");
  expect(r.html).toContain("allow-scripts");
});

test("blocks javascript: URL in iframe src", () => {
  const r = sanitize(`<iframe src="javascript:alert(1)" sandbox="allow-scripts"></iframe>`);
  // sanitize-html should strip the bad src; the iframe element itself may stay
  // but without the dangerous src
  expect(r.html).not.toContain("javascript:");
});

test("blocks data: URL in iframe src", () => {
  const r = sanitize(`<iframe src="data:text/html,<script>alert(1)</script>" sandbox="allow-scripts"></iframe>`);
  expect(r.html).not.toContain("data:");
});

test("strips on* handlers from iframe", () => {
  const r = sanitize(`<iframe src="https://x.com" onload="alert(1)" sandbox="allow-scripts"></iframe>`);
  expect(r.html).not.toContain("onload");
});

test("allows iframe srcdoc for inline isolated content", () => {
  const r = sanitize(`<iframe srcdoc="<p>hello</p>" sandbox="allow-scripts"></iframe>`);
  expect(r.html).toContain("srcdoc");
});

test("normalizes empty sandbox to default flags", () => {
  const r = sanitize(`<iframe src="https://x.com" sandbox=""></iframe>`);
  expect(r.html).toMatch(/sandbox="[^"]+"/);
});

test("preserves <time datetime> for live note entries (v0.9.0)", () => {
  const r = sanitize(`<article class="entry"><time datetime="2026-05-12T08:00:00Z">12 May 08:00</time><h4>Morning sync</h4></article>`);
  expect(r.html).toContain("<time");
  expect(r.html).toContain('datetime="2026-05-12T08:00:00Z"');
  expect(r.html).toContain("12 May 08:00");
});
