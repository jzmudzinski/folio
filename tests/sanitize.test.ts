import { expect, test } from "bun:test";
import { sanitize } from "../src/core/sanitize";

test("strips <script>", () => {
  const r = sanitize(`<p>ok</p><script>alert(1)</script>`);
  expect(r.html).not.toContain("<script");
  expect(r.html).toContain("<p>ok</p>");
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
