import { expect, test } from "bun:test";
import { sanitize } from "../src/core/sanitize";

test("preserves <button> with type + click handler markup (v0.17.1+)", () => {
  const r = sanitize(`<button type="button" id="my-btn" class="primary" disabled>Click me</button>`);
  expect(r.html).toContain("<button");
  expect(r.html).toContain('type="button"');
  expect(r.html).toContain('id="my-btn"');
  expect(r.html).toContain("disabled");
  expect(r.html).toContain("Click me");
});

test("preserves <button onclick=...> stripped of the inline handler", () => {
  // sanitize-html drops on* handlers; button element itself stays.
  const r = sanitize(`<button onclick="alert(1)">Bad</button>`);
  expect(r.html).toContain("<button");
  expect(r.html).not.toContain("onclick");
  expect(r.html).not.toContain("alert");
});

test("preserves <input> with type variants + form attrs", () => {
  const r = sanitize(
    `<input type="text" name="q" placeholder="search" maxlength="100" required>` +
    `<input type="checkbox" name="agree" checked>` +
    `<input type="range" min="0" max="10" step="1" value="5">`
  );
  expect(r.html).toContain('type="text"');
  expect(r.html).toContain('placeholder="search"');
  expect(r.html).toContain('type="checkbox"');
  expect(r.html).toContain("checked");
  expect(r.html).toContain('type="range"');
  expect(r.html).toContain('step="1"');
});

test("preserves <select>/<option>/<optgroup>", () => {
  const r = sanitize(
    `<select name="theme"><optgroup label="Light"><option value="linen" selected>Linen</option><option value="newsroom">Newsroom</option></optgroup></select>`
  );
  expect(r.html).toContain("<select");
  expect(r.html).toContain("<optgroup");
  expect(r.html).toContain('label="Light"');
  expect(r.html).toContain('value="linen"');
  expect(r.html).toContain("selected");
});

test("preserves <textarea>, <label for>, <form>, <fieldset>, <legend>", () => {
  const r = sanitize(
    `<form action="/x" method="post" novalidate>` +
    `<fieldset><legend>Profile</legend>` +
    `<label for="bio">Bio</label>` +
    `<textarea id="bio" name="bio" rows="4" placeholder="…"></textarea>` +
    `</fieldset></form>`
  );
  expect(r.html).toContain("<form");
  expect(r.html).toContain("<fieldset");
  expect(r.html).toContain("<legend>Profile</legend>");
  expect(r.html).toContain('<label for="bio">');
  expect(r.html).toContain("<textarea");
  expect(r.html).toContain('rows="4"');
});

test("preserves aria-* attrs + role globally (v0.17.1+)", () => {
  const r = sanitize(
    `<div role="button" tabindex="0" aria-label="Close" aria-pressed="false">×</div>` +
    `<div role="status" aria-live="polite" aria-atomic="true">Saved.</div>`
  );
  expect(r.html).toContain('role="button"');
  expect(r.html).toContain('aria-label="Close"');
  expect(r.html).toContain('aria-pressed="false"');
  expect(r.html).toContain('aria-live="polite"');
});

test("iframe DEFAULT_IFRAME_SANDBOX includes allow-modals (v0.15.1+)", () => {
  const r = sanitize(`<iframe src="https://example.com/embed"></iframe>`);
  // window.print() / alert() inside the iframe need allow-modals.
  expect(r.html).toContain("allow-modals");
});

test("preserves <style> at body level (v0.15+ — for plain theme + custom looks)", () => {
  const r = sanitize(`<style>.hero{font-size:64px;color:#ff5a1f}</style><div class="hero">Hi</div>`);
  expect(r.html).toContain("<style");
  expect(r.html).toContain(".hero{font-size:64px;color:#ff5a1f}");
  expect(r.html).toContain('class="hero"');
});

test("preserves <style> with media query + dark-mode rules", () => {
  const css = "body{background:#fff;color:#000}@media (prefers-color-scheme: dark){body{background:#000;color:#fff}}";
  const r = sanitize(`<style>${css}</style><p>hello</p>`);
  expect(r.html).toContain("@media (prefers-color-scheme: dark)");
  expect(r.html).toContain("background:#000");
});

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

test("v0.18.2: arbitrary data-* attributes survive on any element (agent-built widgets)", () => {
  // Repro of the bug that broke tab-switching in the public-sharing guide:
  // generic data-tab / data-panel on <button> + <div> got stripped, so the
  // JS handler (which read via getAttribute('data-tab')) saw nulls. Folio's
  // own data-folio-* hooks are tested elsewhere; this one covers agent
  // freeform usage.
  const r = sanitize(
    `<div data-tab-root="x" data-foo="bar">
       <button data-tab="cli">CLI</button>
       <button data-tab="mcp">MCP</button>
       <section data-panel="cli">cli content</section>
       <section data-panel="mcp" hidden>mcp content</section>
     </div>`
  );
  expect(r.html).toContain('data-tab-root="x"');
  expect(r.html).toContain('data-foo="bar"');
  expect(r.html).toContain('data-tab="cli"');
  expect(r.html).toContain('data-tab="mcp"');
  expect(r.html).toContain('data-panel="cli"');
  expect(r.html).toContain('data-panel="mcp"');
  // Note: boolean `hidden` (no value) is stripped by sanitize-html upstream;
  // covered separately below — out of scope for this data-* test.
});

test("known limitation: boolean attributes without values are stripped by sanitize-html", () => {
  // sanitize-html drops attributes that have no value. `<section hidden>`
  // becomes `<section>`. Agents needing initial-hidden state should use a
  // CSS class (`is-hidden { display:none }`) rather than a raw `hidden`
  // attribute in static HTML, OR write `hidden="hidden"` explicitly which
  // does survive.
  const stripped = sanitize(`<section hidden>x</section>`);
  expect(stripped.html).toBe("<section>x</section>");

  const explicit = sanitize(`<section hidden="hidden">x</section>`);
  expect(explicit.html).toContain('hidden="hidden"');
});

test("v0.18.2: existing data-folio-* hooks still survive the wildcard switch", () => {
  // The wildcard replaced specific data-folio-* entries — make sure none
  // of Folio's own hook points regressed.
  const r = sanitize(
    `<article data-folio-content data-folio-id="01HX">
       <section data-folio-live-feed></section>
       <div data-entry-id="abc123">entry</div>
     </article>`
  );
  expect(r.html).toContain("data-folio-content");
  expect(r.html).toContain('data-folio-id="01HX"');
  expect(r.html).toContain("data-folio-live-feed");
  expect(r.html).toContain('data-entry-id="abc123"');
});
