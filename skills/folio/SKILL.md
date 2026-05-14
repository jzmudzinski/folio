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
- **Tools:** `create`, `get`, `list`, `search`, `finalize`, `unfinalize`, `suggest_thread`, `list_expiring`, `list_themes`, `export`, `attach_asset`, `append_entry`, `list_entries`, `set_pinned`, `version` (MCP server name `folio` → mcporter syntax: `folio.create`, `folio.search`, …)
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

3.  (optional) attach_asset({ thread_id, filename, content_base64 | source_path })
    ↳ For every image / PDF / video you want embedded in the note. Returns
      `{url, local_url, ...}` — use `url` directly in body_html below.

4.  Generate body_html consistent with STYLEBOOK.md for the chosen theme.
    Reference any asset URLs from step 3 as <img src="<url>" alt="...">,
    <video src="<url>" controls>, or <a href="<url>"> for PDFs.
    For LIVE notes: body_html may be empty/minimal chrome — the feed
    becomes the content via append_entry.

5.  create({ type, title, body_html, thread_id, theme?, tags?, live? })
    ↳ Theme from user config (default linen) unless you override deliberately.
    ↳ Leave theme_profile at its default ("hosted").
    ↳ live: true → returns stream_url + local_stream_url; type defaults
      to journal in the CLI, but in MCP you must pass type explicitly.

6.  Respond to the user with:

    MEDIA:<public_url>          // public_url falls back to local_url
                                // when no viewer_public_url is configured
    
    <3-5 line TL;DR — not the whole note, just the essence of what's there>
    
    <Tags: tag1, tag2>  ← optional, when non-obvious

7.  REMEMBER the `id` in session context — when the user asks for an iteration
    ("different version", "polish this"), reuse the same `thread_id` for
    the new note (do NOT edit the old one — ADR-014 append-only).
```

---

## Live notes (v0.9.0+)

Some notes grow over time — a journal that gets a new entry every morning, a todo list whose items change state, an ops feed an agent appends to all day. Create them with `live: true`. The note's body_html stays minimal (or empty) at create time; entries land in a sidecar `<slug>.entries.jsonl` via `append_entry`.

**Two render modes** (v0.17+):

- **Panel mode** (default — `live: true`, `inline` omitted or false): entries render in a separate panel beside the body iframe. The body itself stays static. Best when the body is its own document and the feed is metadata about it (e.g. an ADR with running comments, a research note with live citations).
- **Inline mode** (`live: true, inline: true`): entries render INSIDE body_html on every viewer hit, plus new entries arrive in real time via parent→iframe postMessage. **No side panel.** Best when the document IS the feed — daily journal, todo list, ops log, capture target. The body grows as you append.

The viewer chrome streams entries via SSE; for inline notes the chrome forwards each entry into the body iframe's `<section data-folio-live-feed>` placeholder. When the user (or you, when explicitly asked) calls `finalize`, Folio compiles the feed into body_html permanently and the live behavior shuts off — note becomes indistinguishable from any other final note.

> **Talking to the user about live notes — be precise about WHERE updates appear.** For panel-mode notes: "entries appear in the side panel on the right." For inline-mode notes: "entries appear inline in the note body." Don't say "feed refreshes via SSE" without specifying the location — that's where humans get confused and think the document body should be updating when it's actually the panel.

**When to use `live: true`:**
- ✅ Long-running observation (daily journal, weekly retro, project ops log) — usually `inline: true`
- ✅ Todo list / inbox / capture target — items appear, mutate, get resolved → `inline: true`
- ✅ Agent watches an external source and posts what arrives (CI, Slack, Linear, sensor data) → `inline: true`
- ✅ Multi-session context — you want to be able to append more entries hours/days later
- ✅ Long-form note that grows annotations / comments over time → panel mode (body stays the canonical document)

**When NOT to use:**
- ❌ One-off note (regular `create` is the right call)
- ❌ Anything that's already finished thinking — just write it as body_html

**Picking inline vs panel:**
- The document IS the feed (journal, todo, log, capture) → `inline: true`
- The document has its own structure and the feed is meta-commentary → panel mode (default)
- Default to `inline: true` for `type: "journal"` unless you have a reason not to.

**Inline body_html shape:** include a `<section data-folio-live-feed></section>` placeholder where you want entries to land. If you omit it, Folio appends one to the end of body. Around the placeholder, you can put any static chrome — heading, lead paragraph, footer:

```html
<span class="eyebrow">Daily journal · 2026-05-14</span>
<h1>Today</h1>
<p class="lead">Tracking what mattered.</p>
<section data-folio-live-feed></section>
```

**Tool surface for live notes:**

```
create({ ..., live: true, inline?: boolean })  → returns stream_url + local_stream_url
append_entry({ note_id, content_html, tags, refs?, importance?, source_ref? })
list_entries({ note_id, since?, tag?, limit? })  → for context resume
set_pinned({ note_id, entry_ids[] })  → ≤ 5; full target list, diff is computed
finalize({ id })  → compiles entries into body_html, archives jsonl
```

**Chain-of-entries — how you "edit" tags:**

Entries are append-only. To change an entry's state, append a new entry that references it via `refs:[<entry-id>]` with the new tags. Folio compiles tag sets on read: namespaced tags (`ns:value`) use last-write-wins, non-namespaced tags accumulate. Worked example:

```
# 1. Append a todo
append_entry({ note_id: N, content_html: "<p>Ship v0.9</p>", tags: ["state:open", "project:folio"] })
  → entry_id = "p02merb8na"

# 2. Append a follow-up that marks it done (the follow-up itself may
#    have content OR be empty — empty entries don't render but their
#    tags still compile onto the refs target).
append_entry({ note_id: N, content_html: "<p>Merged and tagged.</p>", tags: ["state:done"], refs: ["p02merb8na"] })
  → entry_id = "kq3z8rkfx2"

# 3. list_entries now shows entry p02merb8na with compiled_tags ["state:done", "project:folio"]
#    and state="done" — viewer renders it strikethrough.
```

## Tag conventions for live notes

Folio doesn't validate tag values at the schema level. It does have **exactly two rendering opinions**:

| Namespace / tag | Folio renders | Meaning |
|---|---|---|
| `state:open` | default (no decoration) | not yet done |
| `state:done` | strikethrough + dimmed | completed |
| `state:cancelled` | dimmed (no strikethrough) | abandoned |
| `state:snoozed` | amber "snoozed" pill | deferred |
| `view:pinned` | pulled to "Worth noticing" rail at top of feed panel | high salience |

Everything else is convention space. Recommended namespaces:

- `priority:1` … `priority:5` (1 = highest)
- `source:slack` / `source:ci` / `source:linear` / etc. — origin of the data
- `project:<slug>` / `topic:<slug>` / `client:<slug>` — same convention as note-level tags
- `kind:bug` / `kind:idea` / `kind:question` — discriminator within a single note
- Free-form `#tag` style (no namespace) — accumulates, no override

These render as generic pills + show up as auto-facets in the panel sidebar. Pick a namespace pack at the start of a thread and stick with it.

**`view:pinned` → use `set_pinned` instead of raw appends.** The `set_pinned` tool takes the COMPLETE target list of pinned entry ids (≤ 5), diffs against current pinned state, and appends the minimal pin/unpin entries to reach the target. Don't manually append `view:pinned` and `view:unpinned` chains unless you know exactly what you're doing.

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
| Custom layout, poster, demo, ASCII art, experimental viz | `plain` | Almost-bare canvas (reset + container + dark-mode); **no utility classes** — agent writes its own `<style>` block at the top of body_html and owns the visual identity |

**Rule:** if the user didn't say, use the default. Suggest an override ONLY when the context strongly fits (e.g. user says "make me an ADR" → suggest `folio` or `terminal`; "build me a poster" or "draw an ASCII map" → suggest `plain`).

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
- ❌ `style="..."` inline (beyond exceptional cases — bar width, custom accent — or in the `plain` theme where it's the expected pattern)
- ❌ `<html>`, `<head>`, `<body>`, `<title>`, `<meta>` — the template wraps your fragment
- ⚠️ `<style>` at body level — allowed since v0.15 but **default to theme.css classes**. Reach for a body-level `<style>` block only when (a) `theme: "plain"` is in play, or (b) the standard utilities genuinely don't fit the layout. Don't redefine `.eyebrow` / `.card` / `.pill` inside body_html — confusing for the user previewing across themes.
- ❌ `<font>`, `<center>`, deprecated HTML4 tags
- ❌ Raw hex colors in attributes — use the classes

**`<script>` at body level IS allowed** (since v0.3). Notes are served from `/raw/:id` into a null-origin sandboxed iframe with CSP `connect-src 'none'` + `form-action 'none'`, so your script can build DOM and run handlers but cannot reach the parent window, cookies, localStorage, or any network endpoint. Default pattern for interactivity — inline `<script>` in body, not iframe srcdoc:

```html
<button type="button" id="filter-btn" class="primary">Filter</button>
<input type="text" id="filter-input" placeholder="filter…">
<div id="results"></div>
<script>
(function () {
  // v0.17.1+: <button>, <input>, <select>, <option>, <textarea>, <label>,
  // <form>, <fieldset>, <legend>, <output>, <progress>, <meter> all pass
  // the sanitizer in static HTML. So do role="…", tabindex, aria-*, title.
  // No createElement workaround needed for form controls.
  var btn = document.getElementById("filter-btn");
  var input = document.getElementById("filter-input");
  var results = document.getElementById("results");
  btn.addEventListener("click", function () {
    results.textContent = "filtered: " + input.value;
  });
  // theme.css classes (.card / .pill / .verdict) apply natively whether
  // you write the element statically or build it via createElement.
})();
</script>
```

**Native HTML when sufficient:** for expand/collapse use `<details><summary>...</summary>...</details>` — no JS needed.

**When `<iframe>`:** third-party embeds only — YouTube, CodeSandbox, Observable, Loom. Use `src="https://..."`. Iframe `srcdoc=` for your own HTML/JS was the pre-v0.3 workaround; today it's overhead and the inner content loses theme inheritance.

```html
<iframe src="https://codesandbox.io/embed/abc"
        sandbox="allow-scripts"
        width="100%" height="400"
        title="Live demo"></iframe>
```

Sanitizer enforces (when you do iframe): `src` only `https://`, `sandbox` always present with `allow-same-origin` stripped, default sandbox `allow-scripts allow-popups allow-forms`, `on*` handlers dropped, `referrerpolicy="no-referrer"`.

---

## Tagging

`tags` in `create`:
- Specific: `["postgres", "saas", "comparison"]`, not generic `["analysis"]`
- Lowercase, kebab-case
- 2-5 tags per note, no more
- A tag = what the user will use when searching
- Per-project conventions work (e.g. `client:<slug>`, `project:<slug>`, `topic:<slug>`) — the viewer aggregates tags in the sidebar and offers a per-tag view at `/tag/<slug>`

---

## Attaching assets to threads (v0.7.0+)

`attach_asset` drops a binary (image, PDF, video) into `threads/<thread_id>/assets/<filename>` and returns a stable URL you can paste into `body_html`. Use it instead of inlining base64 in HTML — base64 bloats the note, breaks copy-as-markdown, and the file gets buried.

**When to attach:**
- ✅ Agent generated a chart / diagram and wants it visible in the note
- ✅ User dropped a photo into chat ("save this to today's journal")
- ✅ Long PDF user wants kept beside the research summary
- ✅ Telegram / email bot relaying media → assetize it, then reference the URL in the note body

**Call shape:**
```
attach_asset({
  thread_id: "morning-ride-2026-05-12",
  filename: "speed-chart.png",
  content_base64: "<base64>"     // OR source_path: "/abs/path/file.png"
})
↳ returns { thread_id, filename, path, url, local_url, size_bytes }
```

Use `url` in `body_html`. It already uses `viewer_public_url` (if configured), so the link works for relayed contexts (Telegram bot, email) and falls back to `127.0.0.1` otherwise.

**Embed patterns:**
```html
<img src="<url>" alt="Speed over time — peaks at 38 km/h around km 14" width="800">
<video src="<url>" controls></video>
<a href="<url>" target="_blank">↗ Open PDF</a>
```

Always write a real `alt` — binary content is NOT FTS-indexed; the alt text is what makes the asset searchable. Set `width`/`height` on `<img>` to prevent layout shift.

**Filename rules** (enforced server-side, errors loudly):
- ASCII alphanumeric + `.` `_` `-`, ≤ 200 chars
- No leading/trailing dot, no `..`, no path separators
- Extension allowlist: `jpg / jpeg / png / webp / gif / svg / pdf / mp4`
- Use slug-style names: `speed-chart.png`, `route-map-v2.svg`, `q3-report.pdf`

**Overwrite vs versioning:**
- Same `filename` = overwrites in place (idempotent upload — useful for retrying)
- Want to keep both versions? Use a new filename (`chart-v2.png`). The note that referenced `chart.png` keeps pointing to whatever bytes are at that path
- Note files themselves stay append-only (ADR-014). Asset overwrite is a separate convention

**Order with `create`:** attach first (you need the URL), then `create` with `body_html` that references it. Same `thread_id` in both calls.

---

## Anti-patterns

- ❌ **Spamming `create`** for things that should live in agent memory or chat (short answers like "what's RAG?")
- ❌ **Skipping `suggest_thread`** → creates duplicate threads. ALWAYS check first.
- ❌ **Generating body without consulting the stylebook** → notes look inconsistent
- ❌ **Missing metadata** (tags) — hurts retrieval
- ❌ **Writing inline-styled HTML like it's 2005** — use the classes from theme.css
- ❌ **Editing**: if the user asks "fix this" → create a NEW note in the same thread (append-only, ADR-014)
- ❌ **Marking `is_final: true` on your own** — that's the user's call (from the viewer / CLI / explicit request)
- ❌ **Inlining base64 binaries in `body_html`** — bloats the note, breaks copy-as-markdown, no FTS lift. Use `attach_asset` then reference the returned URL
- ❌ **Calling `attach_asset` without thinking about the filename** — `IMG_4521.jpg` from a phone camera is fine, but generated assets deserve a slug name (`speed-chart.png` beats `chart1.png`). The filename is forever for that URL

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
