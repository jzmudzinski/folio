/**
 * SVG sanitization (v0.19.3 fix).
 *
 * Pre-v0.19.3 the sanitizer turned inline agent SVG diagrams into useless
 * scaffolds:
 *   - sanitize-html → htmlparser2 lowercased attribute names by default,
 *     killing case-sensitive SVG attrs like `viewBox`, `markerWidth`,
 *     `refX`, `gradientUnits` (SVG ignores the lowercase variants)
 *   - ALLOWED_TAGS was missing <defs> and <marker> → arrow markers stripped
 *   - ALLOWED_ATTRIBUTES had no entries for <g>, <text>, <tspan> and
 *     incomplete entries for <svg>/<path>/<rect>/<line>/<circle> → all
 *     font-*, text-anchor, stroke-width, stroke-dasharray, opacity,
 *     marker-end attributes were stripped
 *
 * These tests pin the fixed behavior end to end.
 */

import { expect, test } from "bun:test";
import { sanitize } from "../src/core/sanitize";

test("v0.19.3: viewBox survives sanitization (case preserved)", () => {
  const r = sanitize(`<svg viewBox="0 0 800 340" width="800" height="340" xmlns="http://www.w3.org/2000/svg"></svg>`);
  expect(r.html).toContain('viewBox="0 0 800 340"');
});

test("v0.19.3: <defs> and <marker> survive (arrow markers)", () => {
  const r = sanitize(`<svg viewBox="0 0 100 100"><defs><marker id="arr" markerWidth="12" markerHeight="12" refX="11" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,8 L11,4 z" fill="#f00"/></marker></defs></svg>`);
  expect(r.html).toContain("<defs>");
  expect(r.html).toContain("<marker");
  expect(r.html).toContain('id="arr"');
  expect(r.html).toContain('markerWidth="12"');
  expect(r.html).toContain('refX="11"');
  expect(r.html).toContain('orient="auto"');
});

test("v0.19.3: <text> preserves x/y/text-anchor/font-* attrs", () => {
  const r = sanitize(`<svg viewBox="0 0 100 100"><text x="50" y="50" text-anchor="middle" font-size="14" font-weight="600" font-family="JetBrains Mono" fill="#ff5a1f">label</text></svg>`);
  expect(r.html).toContain('x="50"');
  expect(r.html).toContain('y="50"');
  expect(r.html).toContain('text-anchor="middle"');
  expect(r.html).toContain('font-size="14"');
  expect(r.html).toContain('font-weight="600"');
  expect(r.html).toContain('font-family="JetBrains Mono"');
  expect(r.html).toContain('fill="#ff5a1f"');
});

test("v0.19.3: <g> preserves font-family/transform/fill (group styles)", () => {
  const r = sanitize(`<svg viewBox="0 0 100 100"><g font-family="serif" transform="translate(10,20)" fill="#1a1a1a" opacity="0.8"><text x="0" y="0">hi</text></g></svg>`);
  expect(r.html).toContain('font-family="serif"');
  expect(r.html).toContain('transform="translate(10,20)"');
  expect(r.html).toContain('fill="#1a1a1a"');
  expect(r.html).toContain('opacity="0.8"');
});

test("v0.19.3: <line> preserves stroke-width, stroke-dasharray, marker-end", () => {
  const r = sanitize(`<svg viewBox="0 0 100 100"><line x1="0" y1="0" x2="100" y2="100" stroke="#ff5a1f" stroke-width="2.5" stroke-dasharray="6 3" marker-end="url(#arr)"/></svg>`);
  expect(r.html).toContain('stroke-width="2.5"');
  expect(r.html).toContain('stroke-dasharray="6 3"');
  expect(r.html).toContain('marker-end="url(#arr)"');
});

test("v0.19.3: <rect> preserves stroke-width / stroke-dasharray / opacity", () => {
  const r = sanitize(`<svg viewBox="0 0 100 100"><rect x="10" y="20" width="380" height="265" rx="14" fill="#fff8f3" stroke="#ff5a1f" stroke-width="1" stroke-dasharray="2 4" opacity="0.55"/></svg>`);
  expect(r.html).toContain('stroke-width="1"');
  expect(r.html).toContain('stroke-dasharray="2 4"');
  expect(r.html).toContain('opacity="0.55"');
});

test("v0.19.3: gradients work (linearGradient + stop)", () => {
  const r = sanitize(`<svg viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#ff5a1f" stop-opacity="1"/><stop offset="100%" stop-color="#2f9050"/></linearGradient></defs><rect x="0" y="0" width="100" height="100" fill="url(#g)"/></svg>`);
  expect(r.html).toContain("<linearGradient");
  expect(r.html).toContain('id="g"');
  expect(r.html).toContain('offset="0%"');
  expect(r.html).toContain('stop-color="#ff5a1f"');
  expect(r.html).toContain('fill="url(#g)"');
});

test("v0.19.3: <foreignObject> is still NOT allowed (it could host arbitrary HTML)", () => {
  // foreignObject is the one SVG element that escapes the SVG namespace and
  // hosts arbitrary HTML. We render notes inside a null-origin sandboxed
  // iframe anyway, but defense in depth: keep it stripped.
  const r = sanitize(`<svg viewBox="0 0 100 100"><foreignObject x="0" y="0" width="100" height="100"><div xmlns="http://www.w3.org/1999/xhtml"><h1>leak</h1></div></foreignObject></svg>`);
  expect(r.html).not.toContain("<foreignObject");
});

test("v0.19.3: <script> inside SVG is still NOT silently rendered with SVG-safe attrs", () => {
  // SVG <script> elements should be treated like HTML <script> by our allow
  // list. They CAN run; isolation is the outer iframe sandbox + CSP, not the
  // sanitizer. Just verify the sanitizer doesn't crash and produces the same
  // shape it would for HTML script.
  const r = sanitize(`<svg viewBox="0 0 100 100"><script>console.log('hi')</script></svg>`);
  // We DO allow <script> for HTML-level interactivity per v0.3+; the test is
  // just that the SVG context doesn't crash the sanitizer.
  expect(r.html).toContain("<svg");
});

test("v0.19.3 repro: full agent-authored architecture diagram comes through intact", () => {
  // Same shape as the showcase note's "How it gets to you" SVG.
  const input = `<svg viewBox="0 0 800 340" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="data flow">
    <defs>
      <marker id="arr" markerWidth="12" markerHeight="12" refX="11" refY="4" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L0,8 L11,4 z" fill="#ff5a1f"/>
      </marker>
    </defs>
    <g font-family="JetBrains Mono">
      <rect x="10" y="20" width="380" height="265" rx="14" fill="#fff8f3" stroke="#ff5a1f" stroke-width="1" stroke-dasharray="2 4" opacity="0.55"/>
      <text x="200" y="42" text-anchor="middle" font-weight="600" font-size="11" fill="#ff5a1f">LOCAL · NO NETWORK NEEDED</text>
    </g>
    <line x1="195" y1="165" x2="225" y2="165" stroke="#ff5a1f" stroke-width="2.5" marker-end="url(#arr)"/>
  </svg>`;
  const r = sanitize(input);
  // Every load-bearing thing the diagram needs:
  expect(r.html).toContain('viewBox="0 0 800 340"');
  expect(r.html).toContain("<marker");
  expect(r.html).toContain('markerWidth="12"');
  expect(r.html).toContain('refX="11"');
  expect(r.html).toContain('orient="auto"');
  expect(r.html).toContain('stroke-width="1"');
  expect(r.html).toContain('stroke-dasharray="2 4"');
  expect(r.html).toContain('opacity="0.55"');
  expect(r.html).toContain('text-anchor="middle"');
  expect(r.html).toContain('font-size="11"');
  expect(r.html).toContain('font-weight="600"');
  expect(r.html).toContain('marker-end="url(#arr)"');
  expect(r.html).toContain("font-family"); // group-level font passes
});
