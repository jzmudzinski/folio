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
- **Tools:** `create`, `get`, `list`, `search`, `finalize`, `unfinalize`, `suggest_thread`, `list_expiring`, `list_themes`, `export`, `attach_asset`, `append_entry`, `list_entries`, `set_pinned`, `publish`, `propose_round`, `pick_variant`, `iteration_state`, `wait_for_pick`, `version` (MCP server name `folio` → mcporter syntax: `folio.create`, `folio.search`, …)
- **Stylebook:** `skills/folio/STYLEBOOK.md` (class contract with theme.css)
- **Examples:** `skills/folio/examples/<type>/`

---

## When to use Folio

**YES (triggers):**
- "research [topic]", "expand on", "summarize", "deep dive", "TL;DR this URL"
- "compare X and Y", "compare X vs Y", "differences between"
- "ADR", "technical decision", "spec", "documentation"
- "make me a note about…", "save this to folio"
- **"show me N versions/variants of X", "N wariantów [czegoś]", "design candidates", "mockups", "logo proposals", "I'll pick one and you iterate"** → use `type: "iteration"` (see Iteration notes section, NOT a regular note dumped in chat)
- Proactively after long structured responses (when the chat answer is already a rich artifact, offer: "Save to Folio as [type]?")
- After a long debrief conversation (interview, meeting) → offer `journal`

**NO (anti-triggers):**
- Short conversational answer ("what time is it?", "what's RAG?" when two sentences suffice)
- Editing an existing file outside Folio (Folio does not edit files)
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

    ⚠ BEFORE writing body_html, decide the SHAPE:
    - SINGLE deliverable (one research doc, one comparison, one snippet) →
      proceed to step 5 with the corresponding `type`.
    - APPEND-ONLY FEED (journal, todo, ops log) → `live: true`, see
      Live notes section.
    - N CANDIDATES FOR USER TO PICK BETWEEN (logo variants, hero mockups,
      design directions, email tone options) → `type: "iteration"`, jump
      to the Iteration notes section workflow: create() with chrome only,
      then propose_round() with the N variants, then wait_for_pick().
      DO NOT inline N options into one regular body_html or one chat
      message — the user can't click to pick or fork from a pick.

5.  create({ type, title, body_html, thread_id, theme?, tags?, live? })
    ↳ Theme from user config (default linen) unless you override deliberately.
    ↳ Leave theme_profile at its default ("hosted").
    ↳ live: true → returns stream_url + local_stream_url; type defaults
      to journal in the CLI, but in MCP you must pass type explicitly.
    ↳ For iteration: body_html is just chrome (h1 + intro); variants come
      via propose_round, NOT inside body_html.

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

---

## Iteration notes (v0.18.0+)

A different shape from live notes: agent generates N design candidates, user clicks one in a gallery, agent generates N variants of the pick, repeat. Tree-shaped (every variant has a `parent_variant_id` pointing at the round-winner that spawned it), append-only on the live-entries JSONL substrate.

**When to use `type: "iteration"` — look for these patterns in the prompt:**

| The user said / asked for | Why it's iteration |
|---|---|
| "Show me 3 versions of the landing hero" / "Pokaż mi 3 wersje hero" | N candidates, will pick |
| "Generate 6 logo variants" / "Przygotuj 6 wariantów logotypu" | Design exploration |
| "Iterate on the email template — pick after each round" | Multi-round selection loop |
| "Mockups to choose from" / "kierunki", "propozycje", "warianty" | Multiple directions, pick one |
| "I'll pick one and you'll iterate on it" / "Ja wybiorę któryś, ty rozwiniesz" | Explicit pick-then-refine |
| "Explore some directions for X" + numeric count | Open-ended creative |

**Common ones that ARE iteration even if not phrased that way:** logo design, hero section, email template, onboarding flow, color palette, brand identity, poster, app icon — anywhere the deliverable is visual/creative AND the user wants to choose between agent-generated candidates.

**When NOT to use:**
- ❌ Single deliverable, no comparison ("write the email") → `snippet`
- ❌ Side-by-side comparison of OPTIONS the user already has (Postgres vs MySQL) → `comparison`
- ❌ User is happy with one direction after you describe it in chat — only escalate to iteration when there are multiple to choose between

**Critical anti-pattern:** ❌ NEVER list 3+ design candidates / variants / mockups inline in chat as "Option 1: …, Option 2: …, Option 3: …". The user can't click to pick, can't fork from a pick, loses lineage across rounds. If it would be ≥3 candidates, it's an iteration note — full stop.

**Tool surface (v0.19.1):**

```
create({ type: "iteration", title, body_html, thread_id, theme })
  → body_html is chrome only (h1 + intro); variants live in entries.

propose_round({ note_id, variants[], parent_variant_id? })
  → variants: [{ content_html, label? }, ...]  — usually 2-4 per round
  → parent_variant_id: REQUIRED from round 2+; equals the winner of the previous round
  → returns { round, variant_ids[] }

wait_for_pick({ note_id, for_round, timeout_s = 60 })   ← v0.19.1+
  → blocks until the user picks a variant in the viewer's gallery
  → race-safe: returns immediately if for_round is already picked
  → returns { picked: true, variant_id, round } | { picked: false, timeout: true, current_round }

pick_variant({ note_id, variant_id })
  → usually the viewer fires this when the user clicks
  → agents only call directly for headless / auto-advance flows

iteration_state({ note_id })
  → snapshot: rounds[], lineage[], current_round, is_finalized
```

**Workflow (the load-bearing pattern):**

```
1. create({ type: "iteration", title, body_html, thread_id })
2. propose_round({ note_id, variants })  → { round: 1, variant_ids: [...] }
3. wait_for_pick({ note_id, for_round: 1, timeout_s: 60 })
   ↳ blocks until user clicks; resolves with { variant_id, round }
4. propose_round({ note_id, parent_variant_id: <winner>, variants: [...refined...] })
5. wait_for_pick({ note_id, for_round: 2 })
6. Repeat until satisfied; finalize({ id }) compiles the picked lineage into body_html.
```

**Variant content_html — make it standalone.** Each variant renders in its own sandboxed sub-iframe with a minimal system-font scaffold. CSS doesn't leak between cards. For a strong identity per variant include `<style>` blocks inline at the top of the variant.

**For logos, icons, and other vector graphics: use inline `<svg>`.** Since v0.19.3 the sanitizer fully supports SVG with `viewBox`, `<defs>` / `<marker>` for arrows, gradients, all typography + paint attrs. Inline SVG is the right answer for logo/icon iteration: vector (scales to any size), themable, no external image dependency, no `attach_asset` round-trip. Skeleton:

```html
<!-- variant content_html for a "logo proposal" -->
<style>
  body { display: flex; align-items: center; justify-content: center; padding: 20px; background: #fff; }
  .logo { display: flex; align-items: center; gap: 10px; font-family: 'Familjen Grotesk', system-ui, sans-serif; }
  .logo__mark { width: 48px; height: 48px; }
  .logo__name { font-size: 26px; font-weight: 600; letter-spacing: -0.02em; color: #1a1a1a; }
  .logo__name span { color: #ff5a1f; }
</style>
<div class="logo">
  <svg class="logo__mark" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
    <circle cx="24" cy="24" r="22" fill="none" stroke="#ff5a1f" stroke-width="2"/>
    <text x="24" y="32" text-anchor="middle" font-family="Familjen Grotesk" font-size="22" font-weight="700" fill="#1a1a1a">R</text>
  </svg>
  <span class="logo__name">rep<span>coach</span></span>
</div>
```

Each variant is a self-contained little canvas. Six of these in one `propose_round` call = six logo directions the user can compare and click.

**Labels matter.** Set a short kebab-case `label` on each variant — the viewer shows it in the gallery card and the lineage breadcrumb after picking. Without it, the viewer falls back to first 4 chars of the variant id. For logos use directional labels (`circuit-R`, `dumbbell-pulse`, `pixel-trainer`, `monogram-RC`) so the user remembers what they picked after round 1.

**On `wait_for_pick` timeout:** the agent should call `iteration_state` to check whether the round was picked between the call and the timeout (rare race window), then either continue with the picked variant or stop the iteration.

**Cloud rendering.** Shared / capability-URL iteration notes render the same gallery but READ-ONLY — picks happen on the device that owns the note. The agent's `wait_for_pick` won't fire on cloud-side clicks since they don't exist; only the owner clicks.

---

## Choosing `type`

**Decision order:**
1. **Is the user asking for N candidates they'll pick between?** → `iteration` (do NOT dump them in chat or use a regular note — see Iteration notes section above).
2. **Is this a feed that grows over time?** → `live: true` (see Live notes section).
3. Otherwise pick from the static-shape table below.

| Prompt signal | Type | Template (slot data) |
|---|---|---|
| **"show me N versions of X", "N wariantów [czegoś]", "design candidates", "logo proposals", "mockups to choose from", "I'll pick one and you'll iterate"** | **`iteration`** | (no template — variants live as entries, see Iteration notes section) |
| "compare", "vs", "differences between", scorecard (user already has the options, just wants them side-by-side) | `comparison` | `comparison.html.eta` |
| "research", "deep dive", "everything about", "summarize URL" | `research` | `research.html.eta` |
| "debrief", "diary", "summary of the day / meeting" | `journal` | (custom body_html — no dedicated MVP template) |
| "ADR", "technical decision", "spec", "proposal" | `technical` | `technical.html.eta` |
| "save this" + short content (<400 words), single point | `snippet` | (custom body_html, single card layout) |

**`comparison` vs `iteration` — the load-bearing distinction:** `comparison` is for OPTIONS THE USER ALREADY HAS (Postgres vs MySQL vs SQLite — three real things with known properties, agent renders them side-by-side). `iteration` is for OPTIONS THE AGENT GENERATES (6 logo directions, 3 hero layouts, 4 email tone variants) where the user picks one and the agent generates more from the pick.

If unclear → ask one question. If a user prompt mentions "wariantów / versions / propositions / mockups" + "I'll pick / wybiorę / choose one", treat as iteration.

---

## Choosing `theme`

Default user-wide: usually **linen** (Apple-grade minimal). Override when:

| Context | Theme |
|---|---|
| Public-facing report / customer-facing | `linen` |
| System design / ADR / code-heavy | `folio` |
| Long-form journalism, formal report | `newsroom` |
| Personal brainstorm, journal | `notebook` |
| Manifesto, polemic | `brutalist` |
| Log / debugging / system internals | `terminal` |
| Personal soft communication | `pastel` |
| OSINT, investigation, dossier | `dossier` |
| Scientific paper, academic | `atlas` |
| Design crit, case study | `studio` |
| Decision doc, business memo | `memo` |
| Treatise, philosophy, long essay | `codex` |
| Financial report, KPI review | `ledger` |
| Wabi-sabi observation | `sumi` |
| Retro tech, demoscene | `arcade` |
| Nature writing | `garden` |
| DIY zine, indie hot take | `kraft` |
| Editorial feature, opinion essay | `prism` |
| Custom layout / poster / ASCII art / experimental | `plain` — bare canvas, agent owns the `<style>` block |

**Rule:** default if user didn't say. Suggest override only when context strongly fits ("make me an ADR" → `folio`; "build me a poster" → `plain`).

**After picking:** `list_themes` returns a `prompt_addendum` per theme — read the relevant one before generating body. The theme dictates markup style (newsroom prose-forward, brutalist short sentences, etc.).

---

## Stylebook (contract with theme.css)

Full spec in **`STYLEBOOK.md`**. Quick rules:

**Allowed utility classes:** `.eyebrow`, `.lead`, `.card`, `.cards`, `.verdict`, `.pill` (variants: `.good`, `.bad`, `.mid`, `.acc`, `.info`).

**DO NOT:**
- ❌ `style="..."` inline (except bar widths, custom accents, or theme `plain`)
- ❌ `<html>` / `<head>` / `<body>` / `<title>` / `<meta>` — template wraps your fragment
- ⚠️ `<style>` at body level — allowed since v0.15 but **default to theme classes**. Reach for it only when using `plain` or utilities genuinely don't fit. Never redefine `.eyebrow` / `.card` / `.pill`.
- ❌ `<font>`, `<center>`, deprecated HTML4 tags
- ❌ Raw hex colors in attributes — use classes

**`<script>` at body level IS allowed** (v0.3+). Notes run in a null-origin sandboxed iframe with CSP `connect-src 'none'` + `form-action 'none'`. Script can build DOM and run handlers; cannot reach parent, cookies, localStorage, or any network endpoint.

**Form controls** (`<button>`, `<input>`, `<select>`, `<textarea>`, `<label>`, `<form>`, etc.) + `role` / `tabindex` / `aria-*` + `data-*` all pass the sanitizer (v0.17.1 / v0.18.2). Use natively — no createElement workaround.

**SVG:** full support since v0.19.3 — `viewBox`, `<defs>`/`<marker>`, gradients, paint + typography attrs. Use inline `<svg>` for logos / icons / diagrams.

**Native HTML when sufficient:** `<details><summary>...</summary>...</details>` for expand/collapse — no JS.

**Third-party `<iframe>` embeds** (YouTube, CodeSandbox, Loom, Observable): `src` must be `https://`, `sandbox` always present without `allow-same-origin`, `referrerpolicy="no-referrer"` — sanitizer enforces.

---

## Tagging

`tags` in `create`:
- Specific: `["postgres", "saas", "comparison"]`, not generic `["analysis"]`
- Lowercase, kebab-case
- 2-5 tags per note, no more
- A tag = what the user will use when searching
- Per-project conventions work (e.g. `client:<slug>`, `project:<slug>`, `topic:<slug>`) — the viewer aggregates tags in the sidebar and offers a per-tag view at `/tag/<slug>`

### Project tag — `project:<slug>` is the load-bearing pattern (v0.20+)

In Folio a `thread_id` is **one document and its iterations** (the agent appends a new note when the user asks for "another version"). One project usually spans **many threads** — research, decisions, design, ops log, technical specs. Folio doesn't have a folder/project entity above threads; the convention is a `project:<slug>` tag on every note that belongs to the project. Viewer surfaces it two ways:

- **`/p/<slug>`** — project workspace: one card per thread, with note count + latest activity + ★ final count. Best mental model for users coming from Obsidian folders.
- **`/tag/project:<slug>`** — flat list of every project-tagged note across threads. Same data, less hierarchy.

**Always tag project work:**

```
create({
  type: "research",
  title: "RepCoach onboarding research",
  thread_id: "onboarding",
  tags: ["project:repcoach-fit", "research", "onboarding"],
  ...
})
```

Tell the user where it'll land: include the project URL in the response when relevant — `MEDIA:<note-url>` plus *"see all project threads at `/p/<slug>`"*.

**Don't split project work across systems.** Folio threads + a single `project:<slug>` tag cover the same shape as "one folder per project in Obsidian / Notion". Adding a project plan in Folio and the rest of the project elsewhere fractures the user's context.

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

**Relative URLs are usually right.** Folio rewrites image URLs at render time. Use the **relative** form `/t/<thread>/asset/<filename>` inside `body_html`, NOT the absolute `url` from the `attach_asset` response. Why:

- A relative URL renders correctly under whatever origin the user is viewing the note from — local viewer (`127.0.0.1:4810`), reverse-proxied public host, Tailscale Funnel, capability URL on cloud — all transparent.
- The absolute `url` returned by `attach_asset` is built from `viewer_public_url` in config. If a recipient browses through a DIFFERENT host (Tailscale interface, alias domain, capability URL on a different cloud), absolute URLs break.
- Capability URL rewrites (`/p/<token>/t/.../asset/...`) hook on the `/t/<thread>/asset/<file>` substring — relative or absolute both match, but relative produces cleaner output.

Use the absolute `url` only when relaying outside Folio (email body, Telegram, anywhere the recipient won't be viewing through a Folio origin):

```html
<!-- ✅ inside body_html: relative path -->
<img src="/t/morning-ride-2026-05-12/asset/speed-chart.png" alt="Speed over time — peaks at 38 km/h around km 14" width="800">

<!-- ❌ inside body_html: absolute URL with viewer_public_url -->
<img src="https://my-zeszyt.local/t/morning-ride-2026-05-12/asset/speed-chart.png" ...>
<!-- breaks when user opens the note through Tailscale Funnel, capability URL on cloud, or local viewer -->

<!-- ✅ in an email / Telegram message: absolute URL -->
<a href="https://my-zeszyt.notibox.ai/t/.../asset/...">↗ Open</a>
```

---

## Generating images from scratch (v0.19.3+)

When the agent has an image to show that doesn't exist as a file yet (generated logo, icon, diagram, illustration, chart), pick the right tool — none of them is "hallucinate a URL".

### 1. Vector content → inline `<svg>` (preferred for logos/icons/diagrams)

Since v0.19.3 the sanitizer fully supports inline SVG with `viewBox` (case preserved), `<defs>`, `<marker>` (arrows), gradients, all paint + typography attrs. For logos, app icons, diagrams, simple illustrations, and any flat-color graphic the agent can describe as shapes + text, **inline SVG is the right answer.** Benefits:

- Vector → scales to any size, looks crisp on retina
- Themable → CSS variables / inline styles apply
- No external dependency → no `attach_asset` round-trip, no broken URL risk
- Search-indexable (text content inside `<text>` elements is FTS-visible)
- Same file as the note — `tar` + go

For iteration notes specifically (6 logo variants, 3 icon directions, etc.), each variant's `content_html` should be inline SVG. See the SVG example in the Iteration notes section above.

### 2. Raster content the agent has the bytes of → `attach_asset`

If the agent has access to an image-generation tool (DALL·E, Imagen, Midjourney via MCP, etc.) and gets bytes back, save them via `attach_asset`:

```
attach_asset({
  thread_id,
  filename: "hero-bg-v1.png",      // slug-style, descriptive, forever
  content_base64: "<bytes>"
})
→ { url, local_url, ... }
```

Then reference the asset in `body_html` via the **relative path** `/t/<thread>/asset/<filename>` (see the "Relative URLs are usually right" subsection in Attaching assets above). NEVER inline base64 into `body_html`.

### 3. External-hosted raster → `<img src="<absolute https URL>">`

Only if the image actually lives at a stable public HTTPS URL the agent KNOWS exists (e.g. a CDN, a Wikipedia image, a public API response that returns an image URL). The sanitizer allows `https:` and `data:` schemes for `<img>`.

### What NOT to do

- ❌ **Hallucinating image URLs.** If you didn't call `attach_asset` and didn't generate inline SVG, there is no image. Writing `<img src="https://my-server.local/cool-logo-1.png">` does not create the image — it produces a broken link.
- ❌ **Inline base64 in `body_html`.** Bloats the note, breaks copy-as-markdown, no FTS lift. Use `attach_asset` to store the bytes properly.
- ❌ **External URLs you can't verify.** Don't grab a random image URL from training data and hope it's still up.
- ❌ **For logos / icons specifically: using raster when SVG would do.** A `<svg viewBox="0 0 48 48">` with shapes is almost always better than a 512×512 PNG of the same logo.

---

## Anti-patterns

- ❌ **Spamming `create`** for things that should live in agent memory or chat (short answers like "what's RAG?")
- ❌ **Skipping `suggest_thread`** → creates duplicate threads. ALWAYS check first.
- ❌ **Listing 3+ design candidates / variants / mockups inline in chat** ("Wariant 1: …, Wariant 2: …, Wariant 3: …") **instead of an iteration note.** The user can't click to pick, can't fork from a pick, you lose lineage across rounds. If you're about to type the phrase "here are N options for you to choose from" — STOP and call `create({ type: "iteration" })` + `propose_round` instead.
- ❌ **Putting iteration variants inside `body_html` of a regular note** instead of using `propose_round`. No gallery, no click-to-pick, no lineage. If the user is meant to choose between things, it's iteration.
- ❌ **Generating body without consulting the stylebook** → notes look inconsistent
- ❌ **Missing metadata** (tags) — hurts retrieval
- ❌ **Writing inline-styled HTML like it's 2005** — use the classes from theme.css
- ❌ **Editing**: if the user asks "fix this" → create a NEW note in the same thread (append-only, ADR-014)
- ❌ **Marking `is_final: true` on your own** — that's the user's call (from the viewer / CLI / explicit request)
- ❌ **Inlining base64 binaries in `body_html`** — bloats the note, breaks copy-as-markdown, no FTS lift. Use `attach_asset` then reference the returned URL.
- ❌ **Hallucinating image URLs you didn't actually attach.** If you didn't call `attach_asset` and didn't generate inline SVG, there's no image. Don't write `<img src="https://example.local/cool-logo.png">` and hope it works. See "Generating images from scratch" below.
- ❌ **Using the absolute `url` from `attach_asset` response inside `body_html`** when the host might serve the note under a different domain (Tailscale, reverse proxy, multi-cloud, local + funnel). Use the RELATIVE path `/t/<thread>/asset/<filename>` instead — see "Generating images from scratch".
- ❌ **Calling `attach_asset` without thinking about the filename** — `IMG_4521.jpg` from a phone camera is fine, but generated assets deserve a slug name (`speed-chart.png` beats `chart1.png`). The filename is forever for that URL.

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

## Few-shot examples

Worked agent prompts + expected `body_html` for each type in `skills/folio/examples/<type>/` (research / comparison / technical / snippet). Read before generating an unfamiliar type.
