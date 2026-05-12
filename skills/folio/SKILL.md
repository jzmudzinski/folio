---
name: folio
description: Create visually-rich HTML knowledge artifacts via Folio (folio-mcp). Use when the user asks for research, comparison, deep dive, technical doc, ADR, spec, "make me a note", "compare X and Y", "TL;DR this URL", or any output that would benefit from rich visual layout (tables, scorecards, diagrams, color-coded findings). Also proactively after producing long structured responses — propose saving to Folio. Append-only model: never edits; new version = new note in the same thread folder.
---

# Folio Skill

> Generate visually rich HTML communication artifacts via Folio. Markdown in chat has flat hierarchy; Folio gives you scorecards, color coding, in-page nav, tables.

## Quick reference

- **Install root:** `~/.local/folio` (override via `$FOLIO_PREFIX`)
- **Storage:** `$FOLIO_HOME` (default `~/Folio/`)
- **MCP:** `folio-mcp` (see `docs/mcp-setup.md`)
- **Viewer:** `folio serve` → http://127.0.0.1:4810
- **Tools:** `create`, `get`, `list`, `search`, `finalize`, `unfinalize`, `suggest_thread`, `list_expiring`, `list_themes`, `export`, `version` (MCP server name `folio` → mcporter syntax: `folio.create`, `folio.search`, …)
- **Stylebook:** `skills/folio/STYLEBOOK.md` (class contract with theme.css)
- **Examples:** `skills/folio/examples/<type>/`

---

## When to use Folio

**YES (triggers):**
- "research [topic]", "expand on", "summarize", "deep dive", "TL;DR this URL"
- "compare X and Y", "compare X vs Y", "differences between"
- "ADR", "technical decision", "spec", "documentation"
- "make me a note about…", "save this to folio"
- Proactively after long structured responses (when the chat answer is already a rich artifact, offer: "Save to Folio as [type]?")
- After a long debrief conversation (interview, meeting) → offer `journal`

**NO (anti-triggers):**
- Short conversational answer ("what time is it?", "what's RAG?" when two sentences suffice)
- Editing an existing file outside Folio (Folio does not edit files)
- Daily notes / projects manually managed in Obsidian
- One-off code snippet answering a precise question (unless the user explicitly says "save this")

---

## Mandatory loop (every Folio use)

> Since v0.2.0, tool names have no `folio.` prefix. The server name is `folio`, the tool name is `create` / `search` / `suggest_thread` etc. Clients like mcporter join the two: `mcporter call folio.create --args '...'`.

```
1.  suggest_thread({ title: <proposed title> })
    ↳ If `matches.length > 0` → use the existing `thread_id`.
    ↳ If empty → use `proposed_new_thread` from the response (new thread).

2.  (optional) list_themes()
    ↳ Only when unsure about the theme. Cache in-session — don't re-call.

3.  Generate body_html consistent with STYLEBOOK.md for the chosen theme.

4.  create({ type, title, body_html, thread_id, theme?, tags? })
    ↳ Theme from user config (default linen) unless you override deliberately.
    ↳ Leave theme_profile at its default ("hosted").

5.  Respond to the user with:

    MEDIA:<public_url>          // public_url falls back to local_url
                                // when no viewer_public_url is configured
    
    <3-5 line TL;DR — not the whole note, just the essence of what's there>
    
    <Tags: tag1, tag2>  ← optional, when non-obvious

6.  REMEMBER the `id` in session context — when the user asks for an iteration
    ("different version", "polish this"), reuse the same `thread_id` for
    the new note (do NOT edit the old one — ADR-014 append-only).
```

---

## Choosing `type`

| Prompt signal | Type | Template (slot data) |
|---|---|---|
| "compare", "vs", "differences between", scorecard | `comparison` | `comparison.html.eta` |
| "research", "deep dive", "everything about", "summarize URL" | `research` | `research.html.eta` |
| "debrief", "diary", "summary of the day / meeting" | `journal` | (custom body_html — no dedicated MVP template) |
| "ADR", "technical decision", "spec", "proposal" | `technical` | `technical.html.eta` |
| "save this" + short content (<400 words), single point | `snippet` | (custom body_html, single card layout) |

If unclear → ask one question, or pick `research` as a safe default.

---

## Choosing `theme`

Default user-wide: usually **linen** (Apple-grade minimal). Override when:

| Context | Theme | Why |
|---|---|---|
| Public-facing report / customer-facing | `linen` | Polished, neutral, readable by non-devs |
| System design, ADR, code-heavy | `folio` | Dev-targeted, dark, mono, gradient h1 |
| Long-form journalism, formal report | `newsroom` | Serif gravitas, quieter bullets |
| Personal brainstorm, journal, exploratory | `notebook` | Handwritten headers, casual, hedging OK |
| Strong opinion, manifesto, polemic | `brutalist` | ALL CAPS, no ornament, statement piece |
| Log analysis, debugging, system internals | `terminal` | Mono, green-on-black, code-like |
| Personal soft communication, gentle | `pastel` | Warm rounded, soft accents |
| Investigation, OSINT, deep dossier | `dossier` | Typewriter, manila, "classified" stamp |
| Scientific paper, structured research | `atlas` | Crimson Pro + small caps + dropcap, academic |
| Design crit, case study, brand audit | `studio` | Fraunces display + huge numerals, gallery feel |
| Decision doc, business memo | `memo` | IBM Plex Sans + § markers, executive |
| Treatise, philosophy, long essay | `codex` | UnifrakturCook + EB Garamond rubric, manuscript |
| Financial report, KPI review | `ledger` | IBM Plex Mono + tabular nums, accounting |
| Slow read, wabi-sabi observation | `sumi` | Cormorant + Klee One + vermillion seal |
| Retro tech, demoscene, launch | `arcade` | Major Mono + magenta/cyan glow |
| Nature writing, gentle research | `garden` | Cormorant italic + sage + ❀ |
| DIY zine, indie hot take | `kraft` | Bricolage + risograph duotone |
| Editorial feature, opinion essay | `prism` | Space Grotesk + Newsreader italic |

**Rule:** if the user didn't say, use the default. Suggest an override ONLY when the context strongly fits (e.g. user says "make me an ADR" → suggest `folio` or `terminal`).

**After picking:** `list_themes` returns a `prompt_addendum` for each — read the relevant one before generating body. The theme's stylebook dictates markup structure (newsroom prose-forward, brutalist short sentences, etc.).

---

## Stylebook — contract with theme.css

Full spec in `STYLEBOOK.md` in this folder. In short, use **utility classes from theme.css**:

```html
<span class="eyebrow">Research · AI / ML</span>
<h1>Title</h1>
<p class="lead">Lead 1-2 sentences.</p>

<h3>Section</h3>
<p>Content.</p>
<ul><li>Bullet</li></ul>

<div class="cards">
  <div class="card">
    <h3>Card</h3>
    <p>Description</p>
  </div>
</div>

<table>...</table>

<div class="verdict">
  <h3>Verdict</h3>
  <p>Recommendation.</p>
</div>

<span class="pill good">final</span>
<span class="pill bad">deprecated</span>
<span class="pill mid">wip</span>
<span class="pill acc">accent</span>
```

**Allowed classes:** `.eyebrow`, `.lead`, `.card`, `.cards`, `.verdict`, `.pill` (variants: `.good`, `.bad`, `.mid`, `.acc`, `.info`).

**DO NOT:**
- ❌ `style="..."` inline (beyond exceptional cases — bar width, custom accent)
- ❌ `<style>`, `<script>` (top-level), `<html>`, `<head>`, `<body>`, `<title>`, `<meta>` — the template wraps your fragment
- ❌ `<font>`, `<center>`, deprecated HTML4 tags
- ❌ Raw hex colors in attributes — use the classes

**Folio's sanitizer drops** non-allowed tags and top-level `<script>`. Your clean semantic HTML is best.

**ALLOWED: `<iframe sandbox>`** — for embeds that need `<script>` in an isolated context. Use cases: live demo (CodeSandbox), interactive chart (Observable), filterable 100-row table (srcdoc with your own HTML+JS), video (YouTube), visualization (D3 demo).

```html
<!-- External embed -->
<iframe src="https://codesandbox.io/embed/abc"
        sandbox="allow-scripts"
        width="100%" height="400"
        title="Live demo"></iframe>

<!-- Inline interactive (srcdoc with your own JS) -->
<iframe sandbox="allow-scripts"
        width="100%" height="500"
        srcdoc='<!doctype html><body><script>...</script></body>'></iframe>
```

Sanitizer ENFORCED:
- `src` only `https://` (NOT `data:`, NOT `javascript:`)
- `sandbox` is always present; `allow-same-origin` is ALWAYS stripped (the frame cannot reach the parent origin)
- Missing `sandbox` → automatically set to `allow-scripts allow-popups allow-forms`
- `on*` event handlers are dropped
- `referrerpolicy="no-referrer"` is forced

**When iframe vs `<details>`:**
- ✅ Needs JS (sorting, filtering, state animation, charts) → `<iframe sandbox srcdoc=...>`
- ✅ Third-party embed → `<iframe sandbox src=https://...>`
- ✅ Larger visualization or demo → iframe
- ❌ Accordion, expandable section, "show/hide" → use `<details><summary>...</summary>...</details>` (CSS-only, works everywhere)

---

## Tagging

`tags` in `create`:
- Specific: `["postgres", "saas", "comparison"]`, not generic `["analysis"]`
- Lowercase, kebab-case
- 2-5 tags per note, no more
- A tag = what the user will use when searching
- Per-project conventions work (e.g. `client:<slug>`, `project:<slug>`, `topic:<slug>`) — the viewer aggregates tags in the sidebar and offers a per-tag view at `/tag/<slug>`

---

## Anti-patterns

- ❌ **Spamming `create`** for things that should live in agent memory or chat (short answers like "what's RAG?")
- ❌ **Skipping `suggest_thread`** → creates duplicate threads. ALWAYS check first.
- ❌ **Generating body without consulting the stylebook** → notes look inconsistent
- ❌ **Missing metadata** (tags) — hurts retrieval
- ❌ **Writing inline-styled HTML like it's 2005** — use the classes from theme.css
- ❌ **Editing**: if the user asks "fix this" → create a NEW note in the same thread (append-only, ADR-014)
- ❌ **Marking `is_final: true` on your own** — that's the user's call (from the viewer / CLI / explicit request)

---

## Surfacing expiring notes (proactive)

Per ADR-019 — hard gating:

**YES surface:**
- ✅ User is already in a Folio-related conversation (words: "folio", "note", "research", used folio.* in this session)
- ✅ Natural moment after `create` or `export` — "BTW thread X has 2 more notes expiring"

**NO surface:**
- ❌ Unrelated conversation (Python helper, debugging something else)
- ❌ Same `id` twice within 24h (idempotency)
- ❌ More than 5 notes at once — overwhelming

Mechanism:
```
list_expiring({ within_days: 7, limit: 5 })
↳ If the array is non-empty AND you're in a Folio convo:
   "BTW you have <N> notes expiring: <title 1, title 2, …>.
    Finalize any? `folio finalize <id>`."
```

---

## Editing → create a new note in the same thread

When the user says "fix this / different version / expand with X":

```
1. Identify the current `thread_id` (or look it up with search).
2. create({ ..., thread_id: <same> })
3. Respond with:
   MEDIA:<new_public_url>
   <TL;DR of the new version + what changed vs the previous>
4. The user sees both versions in the thread view. They pick the final one.
```

**DO NOT** call `finalize` on the previous version — the user decides which one is "the right one".

---

## Examples (few-shot)

In the `examples/` folder:

- `research/` — research on RAG vs Fine-Tuning
- `comparison/` — Postgres vs MySQL vs SQLite for SaaS
- `technical/` — ADR-style decision
- `snippet/` — short note

Each has `prompt.md` (the user prompt) and `output.html` (the expected body_html).

---

## Pre-merge test (manual)

1. "Compare Postgres vs SQLite for a small SaaS" → `comparison`, new thread.
2. "Another version, shorter" → `comparison`, same thread, new note.
3. "What do I know about RAG?" → `search "RAG"`, show results, do NOT create a new one.
4. "What's FTS5?" (short) → no Folio, plain answer (anti-trigger).
5. "Save this" after a long answer → `research` or `snippet`.
