# Folio Stylebook — contract with theme.css

> Utility classes shared across every theme (linen/folio/newsroom/notebook/brutalist/terminal/pastel/dossier/atlas/studio/memo/codex/ledger/sumi/arcade/garden/kraft/prism). Each theme implements them in its own aesthetic, but **the structural semantics are consistent**.

## What you generate

**An HTML fragment for `<article>`** — no `<html>`, `<head>`, `<body>`, `<style>`, `<script>`, `<title>`, `<meta>`. Those live in the template.

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

## Iframe embed (sandboxed)

You may embed interactive content via `<iframe>` — the viewer sanitizes and enforces a safe sandbox. Use cases: CodeSandbox, Observable notebook, YouTube, embedded cards, demos from another service.

```html
<iframe
  src="https://codesandbox.io/embed/abc123"
  sandbox="allow-scripts"
  width="100%"
  height="400"
  title="Live demo: useCallback patterns"></iframe>
```

**What is enforced automatically:**
- `src` only `https://` (NOT `data:`, `javascript:`)
- `sandbox` always present; `allow-same-origin` is **always stripped** (frame is cross-origin to parent — no escape)
- Default sandbox if omitted: `allow-scripts allow-popups allow-forms`
- `on*` event handlers dropped
- `referrerpolicy="no-referrer"` forced

**When to iframe:**
- ✅ Embed a third-party demo (CodeSandbox, Observable, Loom, YouTube)
- ✅ Custom interactive widget from a trusted URL
- ✅ Live chart from another origin (D3, ECharts demo page)

**When NOT to iframe:**
- ❌ Inline interactive — use `<details>`/`<summary>` (CSS-only accordion works everywhere)
- ❌ Your own JS in the note body — there is no `<script>` at body level; use iframe srcdoc if you must
- ❌ Auth-wrapped content — the agent has no user session

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

❌ **`<style>` in body_html** — that's the template's job (theme.css)

❌ **`<script>`** — the sanitizer drops it. Not even commented out.

❌ **`<font>`, `<center>`, `<u>`** — deprecated HTML4

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

## We measure (ADR-017)

Every `create` writes to `events`:
- `class_count` — how many theme.css classes you used
- `inline_style_count` — how many `style="..."` (target: 0)
- `sanitizer_drops` — how many things the sanitizer threw out (target: 0; nonzero means exotic markup)

`folio stats` shows `class_match_rate` — % classes vs ad-hoc styling. Target per ADR-012: ≥ 60%.

If you see `inline_style_count > 0` frequently — refactor the stylebook or tighten the user's prompt (someone is trying to generate something the template doesn't natively support).
