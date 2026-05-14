# Theme: Plain

Almost-bare canvas. Use when the standard utility classes (`.eyebrow`, `.lead`, `.card`, `.pill`, `.verdict`) don't fit what the user asked for — when the content wants to be its own visual language: a custom diagram page, a hand-built landing-style layout, an experimental data viz, an ASCII demo, anything that should feel like its own thing rather than "another Folio note."

## Philosophy

Folio's other themes are opinions. **Plain has none.** No accent color, no opinionated typography stack, no eyebrow + lead + verdict scaffolding. Just a CSS reset, a readable body font, a centered container, and sensible defaults for `<table>`, `<pre>`, `<code>`, `<blockquote>`, dark-mode awareness via `prefers-color-scheme`. That's it.

The freedom comes with a contract: **the agent owns the visual identity for this note.** Either inline `style="..."` on every element, or — preferred — a single `<style>` block at the top of body_html that defines the note's classes. Both are sanitizer-allowed since v0.15.

## When to use

- User asked for something visually idiosyncratic ("make me a poster", "build a fake terminal", "draw an ASCII map", "interactive demo")
- The content has a single dominant visual element (a diagram, a chart, a game) and the agent wants to lay it out without fighting `.card` / `.cards` margins
- The note is a vehicle for a `<script>`-built widget where chrome would distract
- Experimental — the agent wants to try something the existing themes don't enable

## When NOT to use

- Anything that fits `research` / `comparison` / `technical` / `journal` shape — those want a real theme so they stay visually coherent with the rest of the user's Folio.
- "I just want clean defaults" — `linen` already is clean defaults. Plain is for "I want to override the defaults."

## Voice

No voice opinion. The agent picks the tone the content needs. For a poster: punchy. For a demo: terse + monospace. For a long-form essay: editorial. Plain doesn't push back.

## Expected pattern

```html
<style>
  .hero { padding: 60px 0; text-align: center; }
  .hero h1 { font-size: 64px; letter-spacing: -0.04em; margin: 0; }
  .hero .tag { color: #888; font-style: italic; margin-top: 10px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin: 40px 0; }
  .grid .cell { padding: 20px; border: 1px solid rgba(0,0,0,0.1); border-radius: 8px; }
  @media (prefers-color-scheme: dark) {
    .grid .cell { border-color: rgba(255,255,255,0.15); }
  }
</style>

<div class="hero">
  <h1>The big idea.</h1>
  <p class="tag">Or whatever the user wants.</p>
</div>

<div class="grid">
  <div class="cell">One.</div>
  <div class="cell">Two.</div>
  <div class="cell">Three.</div>
</div>
```

The base theme.css gets out of the way — your styles override its defaults. The sandboxed null-origin iframe + CSP still protect everything else (no network exfiltration, no parent-window reach), so the experimental freedom doesn't cost safety.

## Available classes from theme.css

**None.** That's the point. The agent defines classes inside the note's own `<style>` block.

The base file does give you:
- Sensible margin reset on body / headings / paragraphs / lists
- `.wrap` + `main` centered container at `max-width: 760px` (override inline if you want full-bleed)
- Dark-mode pairing automatic via `@media (prefers-color-scheme: dark)`
- Monospace stack on `code` / `pre` / `kbd` / `samp`

## Avoid

- Recreating the standard themes' looks (`.eyebrow` / `.card` / `.pill`) — if you want that, pick `linen` / `folio` / etc.
- Inline JS that touches `parent.*` — won't work anyway (sandboxed null-origin iframe), but a reminder.
- `<style>@import url(...)</style>` from external CDNs — CSP `style-src` likely blocks it; either inline the font import via Google Fonts pattern Folio's other themes use, or stick to system fonts.

## Notes for the agent

Plain is a creative-control theme. If you find yourself thinking "I wish I could just write CSS for this one note," that's the signal to pick plain. Other themes optimize for "agent-consistent output across many notes"; plain optimizes for "this one note has its own visual identity."
