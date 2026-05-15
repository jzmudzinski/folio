/**
 * extractBodyHtml (v0.19.2 nested-article fix).
 *
 * The non-greedy regex prior to v0.19.2 stopped at the first nested
 * `</article>` and silently truncated bodies that contained agent-
 * authored `<article>` elements (iter-cards, blog sections, etc.).
 * Symptom: cloud-served notes were ~half the size of local ones.
 *
 * These tests pin the fixed behavior — extract everything between the
 * wrapper opener and the LAST `</article>` in the file, regardless of
 * how many nested articles live inside.
 */

import { expect, test } from "bun:test";
import { extractBodyHtml } from "../src/core/sync";

const wrapped = (inner: string): string =>
  `<!doctype html><html><head><title>x</title></head><body>
<main class="wrap">
  <article data-folio-content>
${inner}
  </article>
</main>
</body></html>`;

test("extracts simple body with no nested articles", () => {
  const got = extractBodyHtml(wrapped("<h1>Hello</h1><p>World</p>"));
  expect(got).toBe("<h1>Hello</h1><p>World</p>");
});

test("v0.19.2: extracts full body when nested <article> elements are present", () => {
  const inner = `<h1>Iteration showcase</h1>
<div class="iter-grid">
  <article class="iter-card" data-pick="a">card A</article>
  <article class="iter-card" data-pick="b">card B</article>
  <article class="iter-card" data-pick="c">card C</article>
</div>
<p>tail content after the cards</p>`;
  const got = extractBodyHtml(wrapped(inner));
  // All three cards survive — pre-fix regex would cut at first </article>.
  expect(got).toContain('data-pick="a"');
  expect(got).toContain('data-pick="b"');
  expect(got).toContain('data-pick="c"');
  // Trailing content (the actual bug symptom) survives too.
  expect(got).toContain("tail content after the cards");
});

test("v0.19.2: handles deeply nested article structure", () => {
  const inner = `<section>
  <article>outer-1
    <article>inner-1</article>
    <article>inner-2</article>
  </article>
  <article>outer-2</article>
</section>
<footer>page footer</footer>`;
  const got = extractBodyHtml(wrapped(inner));
  expect(got).toContain("outer-1");
  expect(got).toContain("inner-1");
  expect(got).toContain("inner-2");
  expect(got).toContain("outer-2");
  expect(got).toContain("page footer");
});

test("falls back to whole file when wrapper marker is missing", () => {
  const raw = "<h1>Pre-template note</h1><p>no wrapper here</p>";
  expect(extractBodyHtml(raw)).toBe(raw);
});

test("falls back when wrapper opener is found but no closing </article>", () => {
  // Pathological: opener present, no closer at all → return whole file
  // rather than producing a malformed slice.
  const raw = `<body><article data-folio-content><h1>x</h1></body>`;
  expect(extractBodyHtml(raw)).toBe(raw);
});

test("v0.19.2 repro of the showcase-note truncation", () => {
  // Real shape that broke: title, lead, iter-demo with 3 cards, then a
  // table + SVG + verdict after. Pre-fix regex grabbed only through the
  // first iter-card's </article>.
  const inner = `<span class="eyebrow">Folio · self-demo</span>
<h1>What you're looking at</h1>
<p class="lead">A Folio note rendering itself.</p>
<div class="iter-demo">
  <article class="iter-card" data-pick="modern">card1</article>
  <article class="iter-card" data-pick="editorial">card2</article>
  <article class="iter-card" data-pick="linen">card3</article>
</div>
<h3>The 20 tools</h3>
<table><tbody><tr><td>Core</td><td>create / get / list</td></tr></tbody></table>
<svg viewBox="0 0 760 220"><rect width="100" height="100"/></svg>
<div class="verdict"><h3>Verdict</h3><p>You just saw Folio.</p></div>`;
  const got = extractBodyHtml(wrapped(inner));
  expect(got).toContain("modern");
  expect(got).toContain("editorial");
  expect(got).toContain("linen");
  expect(got).toContain("The 20 tools");
  expect(got).toContain("<svg");
  expect(got).toContain("You just saw Folio");
});
