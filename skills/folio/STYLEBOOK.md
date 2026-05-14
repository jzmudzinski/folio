# Folio Stylebook — contract with theme.css

> Utility classes shared across every theme (linen/folio/newsroom/notebook/brutalist/terminal/pastel/dossier/atlas/studio/memo/codex/ledger/sumi/arcade/garden/kraft/prism). Each theme implements them in its own aesthetic, but **the structural semantics are consistent**.

## What you generate

**An HTML fragment for `<article>`** — no `<html>`, `<head>`, `<body>`, `<style>`, `<title>`, `<meta>`. Those live in the template. `<script>` at body level **is** allowed since v0.3 (see "Inline scripts" below).

Standard note structure:

```html
<span class="eyebrow">Type · Subcategory</span>
<h1>Title</h1>
<p class="lead">Lead — 1-2 sentences establishing the stakes.</p>

<h3>Section</h3>
<p>Paragraph.</p>

<ul>
  <li>Bullet 1</li>
  <li>Bullet 2</li>
</ul>

<!-- … -->

<div class="verdict">
  <h3>Verdict</h3>
  <p>Conclusion / recommendation.</p>
</div>
```

## Utility classes

### `.eyebrow`
Small, caps label above H1 — category/type.

```html
<span class="eyebrow">Research · AI / ML</span>
```

### `.lead`
Larger, "softer" subtitle under H1. 1-2 sentences.

```html
<p class="lead">Lead establishing context.</p>
```

### `.pill`
Inline status badge. Variants: `.good` / `.bad` / `.mid` / `.acc` / `.info`.

```html
<span class="pill good">✓ done</span>
<span class="pill bad">deprecated</span>
<span class="pill mid">WIP</span>
<span class="pill acc">recommended</span>
<span class="pill info">tip</span>
```

### `.card`, `.cards`
A single card / a grid of cards. A card is a logical unit.

```html
<div class="cards">
  <div class="card">
    <h3>Card A</h3>
    <p>Short description.</p>
  </div>
  <div class="card">
    <h3>Card B</h3>
    <p>Description.</p>
  </div>
</div>
```

### `.verdict`
Conclusion / recommendation — a highlighted block with an accent left border.

```html
<div class="verdict">
  <h3>Verdict</h3>
  <p>Short recommendation on what to pick.</p>
</div>
```

## Sections (h2 / h3)

- **`<h1>`** — the note title (the template generates it, sometimes wrapped in a gradient by `.t-folio`)
- **`<h2>`** — large sections (rarely in research/comparison)
- **`<h3>`** — typical section heading ("TL;DR", "When X", "Verdict")

In `terminal` and `dossier` themes, h3 receives prefix markers via CSS — write clean semantics, the theme handles the ornament.

## Tables

```html
<table>
  <thead>
    <tr><th>Feature</th><th>A</th><th>B</th></tr>
  </thead>
  <tbody>
    <tr><td>Price</td><td>$5</td><td>$10</td></tr>
  </tbody>
</table>
```

Always include `<thead>` + `<tbody>`. theme.css handles styling — don't write inline `border="1"`.

## Lists

```html
<ul>
  <li>Bullet point</li>
</ul>

<ol>
  <li>Numbered step</li>
</ol>
```

Bullet style depends on the theme (linen uses dots, brutalist red arrows, pastel `✿`, dossier `☐`). Write `<li>`; the theme decides the marker.

## Inline

- **`<strong>`** — text emphasis (themes sometimes render lighter, sometimes bolder)
- **`<em>`** — italics (newsroom gives it special treatment)
- **`<code>`** — inline code (mono font + background)
- **`<mark>`** — highlight (theme.css supplies a subtle background)
- **`<a href="...">`** — link

## Code blocks

```html
<pre><code>function example() {
  return 42;
}</code></pre>
```

theme.css formats it. No inline `style="font-family:monospace"`.

## Blockquote

```html
<blockquote>
  "Quote."
  <footer>— Source</footer>
</blockquote>
```

In newsroom-type themes it gets more weight.

## Embedding attached assets

Assets uploaded via `attach_asset` (see SKILL.md) return a stable URL. Reference it directly:

```html
<!-- Image: alt is REQUIRED — it feeds FTS (binary content is not indexed) -->
<img src="<url>" alt="Speed-over-time chart, peaks at 38 km/h" width="800">

<!-- Video -->
<video src="<url>" controls width="100%"></video>

<!-- PDF as a download link -->
<a href="<url>" target="_blank">↗ Open PDF</a>

<!-- PDF inline (works on most browsers) -->
<iframe src="<url>" width="100%" height="600" title="Q3 report"></iframe>

<!-- SVG: inline <svg> is fine (theme styles apply); attached static SVG via <img> works too -->
```

Set `width` / `height` on `<img>` to prevent layout shift while the asset loads. The viewer's lightbox helper (see below) auto-attaches to every `<img>`, so users can zoom — assume the original is full-resolution.

## Live note entries (since v0.9.0)

A live note (`create` with `live: true`) accumulates entries via `append_entry`. Each entry's `content_html` is a small article fragment. Canonical shape:

```html
<article class="entry">
  <time datetime="2026-05-12T08:00:00Z">12 May 08:00</time>
  <h4>Morning sync — agreed on the architecture</h4>
  <p>Quick notes on what we decided. Names and numbers, not narrative.</p>
</article>
```

You generate ONLY the inner content_html — the `<article class="entry">` wrapper plus the tag pills and decoration are added by Folio at render time, based on the entry's tags (`state:*`, `view:pinned`). Don't write your own `class="entry"` wrapper inside content_html.

**Specifically:**
- `<time datetime="...">` is fine and encouraged for human-readable date (sanitizer allows it since v0.9.0). Otherwise the rendered timestamp comes from the entry's `ts` field.
- `<h4>` for the entry headline — already styled per theme.
- `<p>` for body text. Multiple paragraphs OK.
- `<img src="<asset-url>">` works the same as in a regular note — use `attach_asset` first to get a stable URL.
- Same tag rules apply: no `<script>` inside an entry's content_html (sanitizer will keep it but it'll be inert because the panel iframe is null-origin sandboxed without `allow-same-origin`).

**Pinned + state decoration is automatic.** Set `tags: ["view:pinned"]` to pin (use `set_pinned` for diffed updates). Set `tags: ["state:done"]` to render strikethrough. You write the same content_html either way — Folio handles the wrapper class.

**Empty content_html is allowed** for pure tag-mutation entries (used by `set_pinned` internally). They affect compiled tags of their `refs` target but don't render in the feed. Use them sparingly — usually a follow-up entry with real content reads better.

## Inline scripts (since v0.3)

`<script>` at body level **runs**. The note is served from `/raw/:id` into a null-origin sandboxed iframe with CSP `connect-src 'none'`, so a script can build DOM and attach handlers but cannot reach the parent window, cookies, localStorage, or any network endpoint. **This is the default pattern for interactivity — not iframe srcdoc.**

```html
<div id="my-widget">
  <!-- v0.17.1+: form controls pass the sanitizer in static HTML. -->
  <input id="q" type="search" placeholder="filter…">
  <button id="go" type="button">Search</button>
  <div id="results" class="cards"></div>
</div>
<script>
(function () {
  var input = document.getElementById("q");
  var btn = document.getElementById("go");
  var results = document.getElementById("results");
  btn.addEventListener("click", function () {
    // …populate `results` with theme-styled cards…
  });
})();
</script>
```

Form controls available in static HTML (v0.17.1+): `<button>`, `<input>`, `<select>`, `<option>`, `<optgroup>`, `<textarea>`, `<label>`, `<form>`, `<fieldset>`, `<legend>`, `<output>`, `<progress>`, `<meter>`. Plus `role`, `tabindex`, `aria-*` globally. CSP `form-action 'none'` blocks submission attempts; `connect-src 'none'` blocks data exfil — controls only affect in-iframe state.

**Pattern advantages over iframe srcdoc:**
- Theme.css applies natively — `.card`, `.pill`, `.verdict` inherit the user's chosen look
- Theme preview switcher swaps the styling automatically; iframe srcdoc had its own hardcoded CSS that didn't follow
- No HTML attribute escaping nightmares (single-quote srcdoc, `&quot;` for inner quotes, etc.)
- Smaller payload, better copy-as-markdown

**Pattern caveats:**
- The script runs in null-origin context; `fetch`, `XHR`, `WebSocket` are all blocked by CSP
- All data must be inline in the script (no external JSON files)
- For `<script src="…">` only HTTPS CDNs work (CSP `script-src 'self' 'unsafe-inline' https:`)

**Native HTML when sufficient:** for expand/collapse use `<details><summary>...</summary>...</details>` — no JS needed, theme-styled.

## Iframe embed (third-party only)

Use `<iframe>` for **third-party widgets** — YouTube, CodeSandbox, Observable, Loom, Vimeo. For your own HTML/JS, use an inline `<script>` (above) instead — that was the pre-v0.3 workaround, not the recommended pattern.

```html
<iframe src="https://codesandbox.io/embed/abc123"
        sandbox="allow-scripts"
        width="100%" height="400"
        title="Live demo: useCallback patterns"></iframe>
```

Sanitizer enforces automatically:
- `src` only `https://` (no `data:`, no `javascript:`)
- `sandbox` always present; `allow-same-origin` **always stripped**
- Default sandbox if omitted: `allow-scripts allow-popups allow-forms`
- `on*` handlers dropped, `referrerpolicy="no-referrer"` forced

**When iframe srcdoc is still acceptable:** isolated third-party widget output you don't want inheriting the theme (rare). Otherwise default to inline `<script>` in body.

## What the user gets automatically (viewer helpers)

Your note renders in the viewer with helpers attached parent-side. **Design content to take advantage of them:**

- **TOC sidebar appears** when there are **≥ 3 h2/h3 headings** — write longer notes with structured sections rather than a single wall of text. Each heading gets an auto-id, and clicking the ¶ copies a URL to that section.
- **Copy code** button hovers on every `<pre>` — the agent doesn't need to add its own "copy this" CTA in the content
- **Lightbox** on every `<img>` — embed larger images, the user can zoom
- **External links** automatically get `target=_blank` — don't write it in the attribute
- **Reading time** is computed from `word_count` (~220 wpm) — a dense 4-minute research note feels different from a 30-second snippet
- **Copy as plain / markdown** — the agent's HTML should be cleanly semantic so the Markdown conversion comes out clean. Avoid nested oddities (e.g. `<div>` inside `<p>`)
- **Prev/Next in a thread** — when iterating, continue the same `thread_id` (suggest_thread checks)
- **Theme preview switcher** — the user can preview every note in another theme, so content should work across themes (DO NOT hard-code to one — use utility classes, NOT hard-coded colors)

## What NOT to do

❌ **Inline `style="..."`** — breaks theme consistency. Exceptions:
   - `style="width: 70%"` on a div-progress bar (if you propose one)
   - `style="--accent: #abc"` as a custom-property override
   - Nothing else.

❌ **Hex colors in attributes** — use classes like `.pill.good` instead of `style="background:#34c759"`

⚠️ **`<style>` in body_html** — allowed since v0.15 (per [ADR-style note], the sandboxed null-origin iframe + CSP make CSS injection harmless). But default to theme.css classes anyway; reach for a body-level `<style>` block only when the **`plain`** theme is in play or when standard utilities (`.eyebrow` / `.card` / `.pill` / `.verdict`) genuinely don't fit. Don't redefine theme classes inside body_html — that's just confusing.

❌ **`<font>`, `<center>`, `<u>`** — deprecated HTML4

❌ **Reaching for iframe srcdoc when an inline `<script>` would do** — see "Inline scripts" above. The note iframe is already a sandboxed null-origin trust boundary; an inner srcdoc is a second sandbox you almost never need.

❌ **`<div style="display:flex; gap:10px">`** — use `.cards` if it's a card grid, or leave the natural flow

❌ **Marketing tone generation** — "revolutionary", "cutting-edge", "seamlessly", "leverages"

## Tone — per theme

Each theme has `theme.md` with "Voice" and "Avoid" sections — read **the current theme's prompt addendum** before generating. Easiest way: `list_themes` returns the full `prompt_addendum` field for every available theme.

**Linen (default):** clear, measured, public-facing. Generous whitespace.
**Folio:** precise, opinionated, snarky OK. Numbers > vague.
**Newsroom:** journalistic, balanced, prose-forward.
**Notebook:** personal, exploratory, hedging OK.
**Brutalist:** direct, no hedging, short sentences.
**Terminal:** log-entry tone, imperatives, code-aggressive.
**Pastel:** warm, encouraging, gentle.
**Dossier:** investigative, factual, third-person.
**Plain:** **no voice opinion — agent picks what the content needs.** Almost-bare canvas: no utility classes, no accent color, no typography stack. Use for poster-style layouts, custom diagrams, hand-built data viz, ASCII art, experimental one-offs. Expected pattern is a `<style>` block at the top of body_html defining the note's own classes; CSS variables for theming; everything else is your call. Sandboxed iframe + CSP still protect the boundary — the freedom is creative, not security.

## We measure (ADR-017)

Every `create` writes to `events`:
- `class_count` — how many theme.css classes you used
- `inline_style_count` — how many `style="..."` (target: 0)
- `sanitizer_drops` — how many things the sanitizer threw out (target: 0; nonzero means exotic markup)

`folio stats` shows `class_match_rate` — % classes vs ad-hoc styling. Target per ADR-012: ≥ 60%.

If you see `inline_style_count > 0` frequently — refactor the stylebook or tighten the user's prompt (someone is trying to generate something the template doesn't natively support).
