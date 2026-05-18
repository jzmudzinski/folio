# Changelog

All notable changes per release. The latest version is documented in [README.md](README.md). Older entries here for reference.

## v0.22.2 — 2026-05-18

**Inline metadata editing replaces the popover; SKILL clarified.** The v0.22.1 popover was a stopgap — modeled on Share, full form with Save button, page reload. It worked but felt heavy for what is mostly typo fixes and tag adjustments. v0.22.2 swaps it for direct manipulation in the sidebar and clarifies the mutation contract for agents.

### Added (inline UI)
- **Click-to-edit title.** The sidebar H1 gets `class="editable-title" data-note-id` + `tabindex="0"`. Click or focus → `contenteditable=true`; Enter saves; Esc cancels; blur saves. Empty/whitespace title is rejected with a toast. Saving uses the existing `POST /api/notes/:id/metadata`.
- **Tag chips with × remove + autocomplete add.** Each existing tag renders as `<span class="tag-chip">` with a tiny `×` remove button. Clicking × auto-saves the smaller list. A trailing `+ add tag` input filters from a server-embedded `popularTags` list (`listPopularTags(100, 1)` baked at render time — no extra `/api/tags` round-trip per keystroke); Up/Down navigate suggestions, Enter commits. Typing a value that doesn't match any existing tag offers a `+ create "<value>"` affordance.
- **Theme dropdown "Save as default" link.** The inline `<select class="theme-switch">` keeps its preview-on-change behavior (still uses the `?theme=X` URL param for the iframe), but now a `✓ Save as default` link appears next to it whenever the dropdown value differs from the saved theme. Click persists via the metadata endpoint and reloads.
- **`window.__folioToast(msg, isError)` global** — small toast helper used by all three inline editors for save errors / "Title cannot be empty" / etc. Auto-dismisses after 1.8s.

### Removed
- The `✎ Edit metadata` button in `.side-aux`.
- `editMetadataPopoverHtml()`, `editMetadataPopoverJs()`, and the `.edit-pop*` CSS block — all replaced by `inlineMetadataEditorJs()` (single concentrated handler for title + tags + toast; theme save link is wired alongside the existing preview logic in `noteScript`).

### SKILL updated
- **Frontmatter rewritten** to reflect the new mutation contract: *"Body editing: agent-only via the MCP `replace` tool (or new note in the same thread); metadata (title/tags/theme/is_final) is editable inline in the viewer OR via `update_metadata`."* Old wording "Append-only model: never edits" was a v0.21 lie under v0.22.
- **New section "Mutation surfaces (v0.22+)"** with a 3-row table (body / metadata / live entries — who can drive each) and a decision tree mapping user phrases to the right tool. Explicitly names the user-facing inline editors so the agent doesn't intrude on jobs the user can do faster ("you can click the title in the viewer to rename inline").
- **Mandatory-loop step 7 rewritten** — the previous "do NOT edit the old one — ADR-014 append-only" is replaced with a three-branch rule: body change → `replace()`; pure metadata → `update_metadata()` (or hand off to the user's inline editor); different artifact → `create()` with same thread.
- **Anti-pattern bullet** updated: "Refusing to edit because Folio is append-only" is now the anti-pattern, with the supported paths spelled out.

### Tests
- `tests/viewer-edit-metadata.test.ts` rewritten (+5 tests, 13 total) — `editable-title` h1 with data-note-id, `tag-editor` with chip+×+add+suggest, `theme-save` link present and hidden by default, `inlineMetadataEditorJs` embeds popularTags + handles `ArrowDown` navigation + posts to the metadata endpoint, regression guard that the v0.22.1 popover is gone (`id="edit-trigger"`, `id="edit-pop"` not in output). Endpoint cases (happy path, theme rewrites HTML link, no-change, unknown-theme, bad id) unchanged from v0.22.1.
- Full suite: 551 tests across 51 files, all passing (was 546).

### Not changed
- Endpoint `POST /api/notes/:id/metadata` unchanged — it's the substrate; the UI on top swapped.
- Body editing in the viewer remains intentionally absent. No textarea, no rich-text editor, no contenteditable on the article. Body changes flow through the agent via `replace`. This is what the SKILL now spells out.

## v0.22.1 — 2026-05-18

**Edit metadata popover in the viewer.** v0.22.0 shipped the `updateNoteMetadata()` storage function + `update_metadata` MCP tool + `folio edit` CLI but no in-browser UI — users could only edit metadata from the agent or the terminal. v0.22.1 fills the gap with a popover modeled on the Share popover.

### Added
- **`✎ Edit metadata` button** in `.side-aux` (sits above the Copy / Share / Hand-off / Delete actions on every `/n/:id` page). Click opens a popover anchored to the trigger via `getBoundingClientRect()` (same dynamic-position pattern as Share since v0.21.2).
- **Popover form** with title input, comma-separated tags input, theme dropdown, `Final` checkbox. Inputs are prefilled to current values. Save submits only the fields that changed (diffed against the initial snapshot), so a no-touch Save shows a "No changes to save" hint instead of round-tripping to the server.
- **POST `/api/notes/:id/metadata`** in `src/viewer/server.ts`. JSON body accepts any subset of `{title, tags, theme, is_final}`; calls `updateNoteMetadata()` and returns `{ok, updated_fields, meta}` on success, `{ok:false, reason}` with status 400 (unknown theme), 404 (unknown id), or 200 (no-change — a benign info response, not an error).
- **`editMetadataPopoverHtml()` + `editMetadataPopoverJs()`** helpers in `src/viewer/render.ts`, alongside the Share popover helpers. Share/Edit popovers use distinct DOM ids so they don't collide; CSS reuses the same shape (320px width vs 280px for Share — tag input + theme dropdown wanted a bit more room).

### Changed
- The inline theme dropdown in the sidebar (`<select class="theme-switch">`) stays unchanged — still preview-only via `?theme=X` URL param. Permanent theme changes go through the popover. This separation avoids the "did my click just save or just preview?" ambiguity.

### Tests
- `tests/viewer-edit-metadata.test.ts` (+8 tests) — `#edit-trigger` + `#edit-pop` present with prefilled values, JS posts to `/api/notes/:id/metadata` and reloads on success, happy path returns updated meta, theme change rewrites both the DB row and the on-disk HTML `<link>`, no-change returns `ok:false reason:'no-change'` with 200, unknown theme returns 400, bad id returns 404.
- Full suite: 546 tests across 51 files, all passing (was 538).

### Not included (deliberate)
- **Replace UI is still CLI/MCP only.** A "Replace body" textarea in the viewer is a bigger surface (large free-form editor, theme-aware paste handling) and waits for a focused pass. `folio replace <id> --html @file` and the `replace` MCP tool both ship in v0.22.0 already.
- **Click-to-edit on the article title.** The H1 lives inside the body iframe and the parent chrome can't reach it (null-origin sandbox); editing happens via the popover only.

## v0.22.0 — 2026-05-18

**Selective append-only relaxation: metadata editable + `replace` primitive.** Based on the design analysis [Append-only w Folio — czy paradygmat się broni], ADR-014's pure append-only model was found to be inconsistently enforced (live notes already mutate via chain-of-refs) and generated ~30% noise across ~94 real notes — typically v2/v3/v4 versions of the same document, where the only delta was a typo, a tweak, or a sanitizer fix. v0.22.0 ships Step 1 (metadata edits) + Step 2 (`replace` primitive) of the recommended graduated relaxation. Body files remain immutable; the new mutability is metadata-only + supersede pointers.

### Step 1 — metadata is editable

- **`updateNoteMetadata({id, title?, tags?, theme?, is_final?})`** in `src/core/storage.ts`. Edits title / tags / theme / `is_final` in place. The HTML file is regenerated atomically (body extracted via `extractBodyHtml`, re-injected through `renderNote` with new metadata) — no body bytes change. FTS index refreshes. Empty/whitespace title rejected as no-change. Unknown theme returns `{ok:false, reason:"unknown-theme"}`. `is_final` flip routes through `finalize()` / `unfinalize()` so the side effects (live → compiled body, iteration → frozen rounds, expires_at reset) keep their one canonical implementation.
- **`update_metadata` MCP tool** (`src/mcp/server.ts`). Same shape; returns the fresh meta + list of `updated_fields`. The existing `unfinalize` MCP handler was simplified to call the new `unfinalize()` storage function (extracted from inline SQL).
- **`folio edit <id> [--title T] [--theme X] [--tags "a,b,c"] [--final|--unfinal]`** CLI command (`src/cli/commands/edit.ts`). Mutually-exclusive `--final` / `--unfinal` flag pair.

### Step 2 — `replace` primitive

- **New DB column `notes.superseded_by TEXT`** added via migration v4→v5 (`src/core/migrations.ts`) + present in `PHASE2_SCHEMA` for greenfield. Partial index `notes_by_superseded ON notes(superseded_by) WHERE superseded_by IS NOT NULL` covers default-listing filters.
- **`replaceNote({old_id, body_html, title?, tags?, theme?})`** in storage. Creates a new note in the same thread (inheriting type/theme/tags/title from old by default), then sets `old.superseded_by = new.id`. Old `.html` file stays on disk verbatim — capability URLs that pointed at `/n/<old-id>` still resolve to the original content. `already-superseded` guard prevents accidental fork (a chain stays linear).
- **`resolveHeadOfChain(id)`** walks the supersede pointers forward up to 10 hops. Used by the viewer banner.
- **Default-filter listings hide superseded notes.** `listNotes` (+ new `include_superseded?` opt-in), `searchNotes` (+ opt-in), `listNotesByTag`, `listThreads`, `listProjectThreads` (via tag listing) all skip notes with `superseded_by IS NOT NULL`. Thread count in `/threads` reflects head versions only — a 4-note thread collapsed via `replace` shows as `count=1`, which matches the user's mental model.
- **Viewer supersede banner.** `pageNote` renders an indigo-tinted banner on the old URL: *"↻ Replaced — this version has been superseded — [new title] is the current head"* with a direct link. The head note (most recent) has no banner.
- **`replace` MCP tool** + **`folio replace <id> --html @path [--title T] [--theme X] [--tags "a,b"]`** CLI.
- **`note_superseded` event** logged for analytics (carries old_id, new_id, old_title, new_title, thread_id, type).

### Not changed (deliberately)
- **ADR-014 still binds for body bytes.** No edit-in-place tool. The plain-text shape of a published `/n/<id>` is forever — `replace` creates a new URL.
- **`iteration` and `technical` notes still benefit from the existing append-only flow** (variants and ADR drafts are points). `replace` is the right tool for `snippet` / `comparison` / `research` polish — the analysis spells out the per-type calibration in the verdict.
- **Cloud sync schema unchanged.** Superseded notes still push/pull as ordinary notes; cloud-side filtering of supersede chains is deferred (would need a cloud migrator entry + cloud render changes). Practical impact: local viewer hides superseded versions; the public/relayed cloud view shows all versions until cloud catches up. Capability URL trust holds either way (immutable files).

### Tests
- `tests/update-metadata.test.ts` (+13 tests) — title/tags/theme/`is_final` change paths, multi-field combined update, FTS refresh, live note `is_final` compiles entries, no-change / not-found / unknown-theme error reasons, title trim, `updated` timestamp bump.
- `tests/replace.test.ts` (+14 tests) — `superseded_by` set, old `.html` byte-identical after replace, inherit-by-default, overrides applied, listings/search/tag/thread filters hide superseded by default, `include_superseded` reveals them, `already-superseded` and `not-found` errors, `resolveHeadOfChain` walks multi-hop chains, viewer banner present on old URL + absent on head, `note_superseded` event logged.
- `tests/migrations.test.ts` (3 updated) — head schema version bumped from "4" to "5".
- `tests/live-mcp.test.ts` (1 updated) — tool count 20 → 22 (adds `update_metadata` + `replace`).
- Full suite: 538 tests across 50 files, all passing (was 511).

### Migration notes
- Existing dbs auto-migrate on next open: `ALTER TABLE notes ADD COLUMN superseded_by TEXT` (column defaults to NULL — all existing notes are heads). No data loss, no manual step.
- `package.json` bumps to 0.22.0. Tool count in MCP discovery reports 22.

## v0.21.3 — 2026-05-18

**`plain` theme gets a permissive sanitizer.** The plain theme's contract is "the agent owns the visual identity for this note." But the strict allowlist was still stripping safe HTML5 tags like `<b>`, `<i>`, `<u>`, `<s>`, `<q>` along with their `id`s — breaking agent-built widgets that did `getElementById('counter')` against a `<b id="counter">` placeholder. v0.21.3 plumbs a new `mode: "permissive"` option through `sanitize()` that `createNote()` opts into automatically whenever `theme === "plain"`. Other themes are unchanged.

### Changed
- **`sanitize(html, { mode: "permissive" })`** allows every HTML5 tag and attribute, but still scrubs the escape vectors that don't come for free from the iframe sandbox + CSP: on*-handlers stripped from every element, `javascript:` rejected in any URL attribute (`href`/`src`/`action`/`formaction`/`xlink:href`/`background`/`poster`/`data`/`ping`/`cite`/`manifest`/`longdesc`), iframe `sandbox` normalized (allow-same-origin always removed, default flags injected when absent). Side-effecting head-y tags — `<meta http-equiv="refresh">`, `<link rel="stylesheet" href>`, `<base href>`, `<noscript>`, `<title>` — are dropped with their content via `exclusiveFilter`. `<head>`/`<html>`/`<body>` wrappers pass through (inert under the sandbox). Existing case-preserving parser flag (`lowerCaseAttributeNames: false`, `lowerCaseTags: false`) reused so SVG case-sensitive attrs survive.
- **`createNote()` in `src/core/storage.ts`** detects `theme === "plain"` and passes `mode: "permissive"` to `sanitize()`. Every other theme keeps the strict default allowlist — including the `data-*` wildcard, SVG attr maps, iframe transformTags, and form-control surface that prior releases shipped. Live-note `append_entry` keeps the default mode (entries land on whatever theme the note declares, but the entry body is short HTML the strict mode handles fine).

### Tests
- `tests/plain-theme.test.ts` (+6 tests, 10 total) — permissive keeps `<b id="...">`/`<i>`/`<u>`/`<s>`/`<q>` while default strips them; permissive strips `on*`-handlers and `javascript:` URLs from `<a href>`/`<img src>`/`<div onmouseover>`; permissive drops `<meta>`/`<link>`/`<base>`/`<noscript>` and their contents; iframe sandbox still has `allow-same-origin` removed even in permissive mode; createNote with `theme: "plain"` lets a `<b id="counter">` round-trip end to end; createNote with `theme: "linen"` still strips `<b>` (regression guard against accidentally widening default mode).
- Full suite: 511 tests across 48 files, all passing.

### Why
An agent generating an interactive force-directed knowledge graph on the plain theme hit `Cannot set properties of null (setting 'textContent')` because the `<b id="kg-stats-edges">` placeholder it referenced was sanitized away. The plain theme's prompt addendum already promises "Plain has none [of the standard themes' opinions]" — the sanitizer was the last surviving opinion. v0.21.3 makes the contract consistent.

## v0.21.2 — 2026-05-17

Two viewer chrome polish changes following up on v0.21.1.

### Changed
- **Share popover anchors next to its trigger.** v0.21.1 moved the Share trigger into the sidebar but kept the popover at a fixed top-right viewport position — visually disconnected from the click. v0.21.2 positions the popover dynamically: on open, the bootstrap JS reads `trigger.getBoundingClientRect()` and sets inline `top` / `left` so the popover floats just to the right of the trigger. Arrow triangle moves to the left edge, vertical offset set via a `--share-pop-arrow-top` CSS variable so it always points at the trigger's center. Clamps to viewport bounds when the trigger sits low (long sidebar).
- **Topbar "Cloud" → "Sync"; ☁ icon dropped.** The route stays `/cloud` (no redirect needed; existing bookmarks unaffected), but the label is now `Sync` — matches what users actually do there (push/pull). Pre-v0.21.2 label was `☁ Cloud` from when the page was just status-only.

### Tests
- `tests/viewer-shares.test.ts` (+1) — Share popover JS contains `positionNearTrigger` + `getBoundingClientRect` + `--share-pop-arrow-top`.
- `tests/viewer-cloud-ui.test.ts` (1 updated) — topbar Sync link present, ☁ + old "Cloud" label removed.

## v0.21.1 — 2026-05-17

**"Hand off to agent" button + Share trigger moved into the sidebar.** Two viewer chrome changes that group all per-note actions in one place.

### Added
- **`↗ Hand off to agent` button** in `.side-aux`. Click → copies a minimal note reference to the clipboard: URL + title + thread + type + a one-line instruction telling the receiving agent to call `folio.get` for the full body. User pastes the payload into any agent chat. Zero deep links, no per-host URL schemes — works in every agent surface (Claude Code, OpenClaw, ChatGPT, etc.). Visual confirmation on copy ("✓ Copied — paste into your agent chat") that reverts after 1.8s.

### Changed
- **Share trigger moved from topbar to sidebar.** Pre-v0.21.1 the `↗ Share` button lived in the topbar nav (v0.19.0 design). In v0.21.1 it joins the other per-note actions in `.side-aux` (Copy plain / Copy markdown / Raw HTML / Print / **Share publicly** / **Hand off to agent** / Delete). Topbar stays for cross-page nav only (Notes / Threads / Stats / Cloud). The Share popover content + behavior is unchanged — still fixed-position top-right, same form, same active-dot indicator (now next to the sidebar label).
- `topbar()` signature: third arg `shareForId` is now ignored. Old callers keep working as before — the param is just a no-op.

### Tests
- `tests/viewer-shares.test.ts` (+3 tests, 14 total) — Share trigger sits inside `.side-aux` not `v-nav`, topbar nav specifically lacks share-trigger, Hand off button present with all metadata data-* attrs, inline JS contains the expected clipboard payload template strings.

## v0.21.0 — 2026-05-16

**OpenClaw hook integration.** Closes the long-parked future feature: agents hosted in OpenClaw now see Folio events surface in their context on every user turn — without any per-session wiring. `folio install --target openclaw` automates the whole setup (hook directory symlink + config entry); the existing skill + MCP install paths are unchanged.

### Architecture (see `docs/openclaw-integration.md`)

Three integration shapes were evaluated; v0.21.0 ships the simplest. **Option A — polling-on-message hook**: OpenClaw `message:received` fires → hook polls `~/Folio/threads/*/*.entries.jsonl` since last-seen cursor → filters meaningful entries (`kind:pick` / `kind:variant` / `state:done` / `view:pinned`) → pushes summary into the agent's context for this turn. Bounded execution, no daemons, no sockets. Resilient to OpenClaw restarts (cursor on disk). Future options (bridge daemon for autonomous loops between turns) deferred to v0.22+; full rationale in the ADR.

### Added

- **`hooks/openclaw/folio-event-watcher/`** — reference hook implementation in the repo. `HOOK.md` with OpenClaw frontmatter declaring `events: ["message:received"]`; `handler.ts` implementing the polling + filtering + cursor logic (~150 LOC, includes types for the OpenClaw event object).
- **`bundledHooksDir()`** in `src/core/config.ts` — sibling to `bundledSkillsDir()`. Resolves the hooks dir via `FOLIO_BUNDLED_HOOKS_DIR` env override → execPath sibling → dev fallback. Tarball includes `hooks/` so `folio install` on a release binary finds it.
- **`folio install --target openclaw` extension** — when the skill flag is on (default), also symlinks `~/.openclaw/hooks/folio-event-watcher/` → `<bundledHooksDir>/openclaw/folio-event-watcher/` and writes `hooks.internal.entries["folio-event-watcher"].enabled = true` to `~/.openclaw/openclaw.json`. Hook lifecycle follows the skill flag — `--mcp-only` skips the hook; `--skill-only` keeps it.
- **`folio uninstall --target openclaw`** — mirror: removes the symlink + the config entry. Refuses to remove a hook directory that isn't a symlink (manually installed).
- **`folio doctor --target openclaw`** — reports hook state alongside skill + MCP. New states: `ok`, `missing`, `wrong-target`, `disabled` (symlink in place but config flag is false), `stale` (symlink target missing).
- **`CheckReport.hook` field** — typed optional field on the install check report. Other targets (Claude Code) don't ship hooks; the field stays undefined for them.

### Tests
- `tests/install-openclaw.test.ts` (+7 tests, 29 total) — install creates hook symlink + writes enabled flag, check reports ok/missing/disabled states, uninstall removes both, `--skill-only` keeps the hook, `--mcp-only` skips it.

### Documentation
- **`docs/openclaw-integration.md`** — ADR-shape: problem, Folio event surfaces, three integration architectures (polling-on-message / bridge daemon / hybrid), trade-offs that drove option A, future work for option B/C.

## v0.20.2 — 2026-05-15

**Iteration gallery auto-refreshes when the next round lands.** Before this release, after the user picked a variant the gallery showed *"Waiting for the agent to propose round N+1…"* and stayed there until the user manually refreshed. The new round was live on disk — the viewer just wasn't watching. Now it watches.

### Fixed
- **`/n/:id/stream` accepts iteration notes.** Pre-v0.20.2 the SSE endpoint gated strictly on `note.live === true` and returned 404 for iteration notes (which carry `live=0` despite using the same JSONL substrate). Widened gate: a note is streamable when `live === true` OR `type === "iteration"`. Existing live-note behavior unchanged; iteration notes now plug into the same hub.
- **Iteration body iframe auto-reloads on `kind:variant` SSE entries.** When `type === "iteration" && !is_final`, pageNote injects a chrome-side `EventSource` subscriber that watches the JSONL stream. On any new `kind:variant` entry (= a new round just landed via `propose_round`) it sets the body iframe's `src` with a cache-buster, triggering a fresh render that shows the new gallery. `kind:pick` entries are skipped — the existing click → POST → reload path already handles pick refreshes; reloading again from SSE would double-flash. Initial backlog burst on connect is suppressed via a 250ms quiet window so opening the page doesn't immediately reload it.

### Tests
- `tests/iteration-viewer.test.ts` (+4 tests, 13 total) — SSE endpoint accepts iteration notes, still 404s on plain snippet, iteration page emits the EventSource subscriber JS, plain pages don't.
- `tests/live-viewer.test.ts` (1 updated) — pre-v0.20.2 error message *"not a live note"* changed to *"not streamable"* to reflect the wider gate.

## v0.20.1 — 2026-05-15

**Sidebar navigation on list pages + context-aware notes.** Caught a real SKILL.md overpromise: I'd claimed earlier "the viewer aggregates tags in the sidebar" but `/tag/:slug` had no sidebar — only a flat list of notes. Users with multi-thread projects had no way to navigate between notes within a tag/project context. The fix is a left sidebar on list pages (mirroring `.note-shell`'s 2-column shape) plus `?from=…` context propagation so individual note pages know which list they came from.

### Added
- **`.list-shell` 2-column layout** for `/tag/:slug` and `/p/:slug`. Sticky scrollable left sidebar (300px) listing items; main content on the right. Mobile collapses to single column with sidebar pinned at top.
- **Sidebar nav on `/tag/:slug`** — every note tagged appears as a list item with title + type pill + age. Click navigates to `/n/<id>?from=tag:<slug>`.
- **Sidebar nav on `/p/:slug`** — notes grouped under thread-name section headers (`research · 3`, `onboarding · 1`); within each section, individual notes link with `?from=project:<slug>`.
- **Context-aware `/n/:id?from=tag:X` and `?from=project:Y`** — when the agent or user arrives via a tagged context, pageNote overrides:
  - "Back to list" → goes to `/tag/:slug` or `/p/:slug` instead of `/`
  - prev/next buttons → walk the list (not thread siblings)
  - sidebar's "Version" line → `In tag` / `In project` with position label "X of N"

Without `?from=`, behavior is unchanged — thread-based prev/next + "Back to list" → homepage.

### Tests
- `tests/project-grouping.test.ts` (5 new tests, 12 total) — sidebar markup on `/tag/`, `/p/`, context-aware nav on `/n/?from=tag:`, `/n/?from=project:`, no-regression for `/n/` without `?from=`.

## v0.20.0 — 2026-05-15

**Project grouping.** Until v0.20 Folio had no first-class abstraction for "a project spanning many threads". Users coming from Obsidian-style folders (one folder = one project, multiple files inside) had to think in flat threads where every `thread_id` is one doc + its iterations. The fix is a **convention + viewer surface** combo — no schema change, no thread-hierarchy refactor, just a tag pattern and a page that groups by it.

### Added — convention
- **`project:<slug>` tag.** The agent puts this tag on every note belonging to a project (research, decisions, design, ops log, technical specs — all carry the same `project:repcoach-fit` tag). SKILL.md gains a new "Project tag" subsection making this the load-bearing pattern.

### Added — viewer
- **`GET /p/:slug`** — project workspace page. Groups every note tagged `project:<slug>` by `thread_id`, renders one card per thread with note count + latest activity + ★ final count + latest note's type pill. Empty state when no notes carry the tag tells the user to ask the agent to add it.
- **`GET /api/p/:slug`** — JSON variant for tooling. Returns `{ groups: [{ thread_id, noteCount, finalCount, latestCreated, notes[] }], totalNotes }`.

### Added — storage
- **`listProjectThreads(projectSlug, limit?)`** in `src/core/storage.ts`. Calls `listNotesByTag('project:<slug>')`, groups by `thread_id`, sorts threads by latest activity descending. Returns the same shape `/api/p/:slug` exposes.

### Tests
- `tests/project-grouping.test.ts` (new, 7 tests) — empty state, cross-thread grouping with counts, finalCount aggregation, sort-by-latest, leak prevention (other projects + untagged notes), full viewer round-trip (HTML + JSON), 400 on empty slug.

### Why not hierarchical thread_ids?
The alternative was nesting threads under projects (`/threads/repcoach-fit/logo/...`). That would have required: filesystem walker changes, sync push/pull schema changes, slug validation rewrite, capability URL routing changes. Tag + view gets the same UX with zero schema migration and clean cohabitation with the existing flat thread model.

## v0.19.5 — 2026-05-15

Single-line SKILL.md fix shipped because it materially changes agent routing in production.

### Changed — `skills/folio/SKILL.md`

Removed the `"Daily notes / projects manually managed in Obsidian"` line from the NO anti-triggers list. Real-world bug report: a paired-chat agent asked to generate **project research** correctly created a Folio research note but then appended *"the full project description goes to Obsidian"* — splitting one deliverable across two systems. Root cause: SKILL was explicitly telling agents reading top-down that **projects** belong to Obsidian, which conflicts with Folio's own research / technical / thread model that handles project work natively (one thread per project, append-only siblings as the project evolves).

It's not Folio's job to tell users where their personal-knowledge-management lives. Removed the line. Other Obsidian-aware skills (if loaded alongside Folio in a stack like notibox / OpenClaw) can make their own routing claims; Folio stays in its lane.

## v0.19.4 — 2026-05-15

Docs-only release to push the SKILL.md changes into the release tarball — the SKILL ships bundled in `dist/skills/folio/SKILL.md` and is what agents load via `folio install --target {claude-code,openclaw}`. The binary itself is unchanged from v0.19.3.

### Changed — `skills/folio/SKILL.md`

**Iteration discoverability fix (PR #48).** Real-world bug: a paired-chat agent received a textbook iteration prompt ("przygotuj 6 wariantów logotypu, ja wybiorę któryś, na podstawie którego rozwiniesz") and answered with 6 logo proposals inline in chat, then (when nudged) made a regular note instead of an iteration note. Audit found five structural holes that made iteration invisible to agents reading the SKILL top-down:

- `Choosing type` decision table now lists `iteration` as the first row with a decision-order preface ("1: N candidates for picking? 2: append-only feed? 3: static").
- YES triggers at top include iteration-shaped phrases ("N wariantów", "show me N versions", "I'll pick one", "design candidates").
- Iteration section's `When to use` expanded into a bilingual PL/EN phrase-mapping table (logo / hero / email / onboarding / palette / poster / app icon).
- Full inline-SVG variant `content_html` skeleton added — agents now have a copy-paste template for logo / icon iteration.
- Mandatory loop step 4 grew a "BEFORE writing body_html, decide the SHAPE" branch listing single / live / iteration with an explicit warning against inlining N variants.

**New "Generating images from scratch" section (PR #48).** Triggered by a separate report: agent embedded image URLs that didn't render (the agent's local `viewer_public_url` host wasn't reachable from the recipient's Tailscale Funnel endpoint). Three valid paths documented — (1) inline SVG preferred for vector, (2) `attach_asset` for raster bytes, (3) verified external HTTPS URL only when proven to exist. Four anti-patterns called out, including hallucinating image URLs and inlining base64.

**"Relative URLs are usually right" subsection in Attaching assets (PR #48).** Use `/t/<thread>/asset/<filename>` inside body_html, not the absolute `url` from `attach_asset` response. Absolute URLs break when the recipient browses through a different host than `viewer_public_url` (reverse proxy, Tailscale Funnel, capability URL on another cloud). The relative form renders against current origin and survives every host the rewriter knows about.

**SKILL trim (PR #49).** Net cut 617 → 525 lines (−15%). Removed pre-iteration content that was self-duplicating ("Editing → new note" section that duplicated Mandatory loop step 7), internal QA leftovers (`Pre-merge test`), and bloat that pointed to better sources (long Stylebook HTML examples → reference `STYLEBOOK.md`; theme-table `Why` column → reference `list_themes` prompt_addendum).

## v0.19.3 — 2026-05-15

Inline SVG diagrams were getting silently destroyed by the sanitizer. Agent-authored architecture diagrams, flowcharts, mini-charts — all stripped of typography, geometry, and arrowheads, then rendered as a pile of unpositioned `<text>` and `<line>` tags. Caught in dogfood of the showcase note's "How it gets to you" diagram: user reported it was illegible; the v2 redesign was equally broken because the bug was in the sanitizer, not the SVG markup.

### Fixed
- **sanitize-html → htmlparser2 was lowercasing both tag names and attribute names by default.** SVG is case-sensitive: `viewBox`, `markerWidth`, `refX`, `gradientUnits` (attrs) and `<linearGradient>`, `<radialGradient>` (tags) are ignored by browsers when lowercased. Set `parser: { lowerCaseAttributeNames: false, lowerCaseTags: false }`. HTML5 tag/attribute names are case-insensitive (browsers normalize at parse time) so this is a no-op for non-SVG content.
- **`ALLOWED_TAGS` was missing `<defs>`, `<marker>`, `<ellipse>`, `<use>`, `<symbol>`, `<linearGradient>`, `<radialGradient>`, `<stop>`.** Arrow markers (every flow diagram needs them) were stripped entirely. Now allowed; `<foreignObject>` stays out (defense in depth — it can host arbitrary HTML/JS).
- **`ALLOWED_ATTRIBUTES` had no entries for `<g>`, `<text>`, `<tspan>`** and incomplete entries for `<svg>` / `<path>` / `<rect>` / `<line>` / `<circle>`. So `font-size`, `font-family`, `text-anchor`, `stroke-width`, `stroke-dasharray`, `opacity`, `marker-end`, `transform`, and all the SVG paint + typography attrs got dropped. Now per-element comprehensive allow-lists covering geometry + paint + typography + markers + clipping.

### Tests
- `tests/sanitize-svg.test.ts` (new, 10 tests) — `viewBox` case-preservation, `<defs>`/`<marker>` survival, text positioning + typography, group-level styles, line/rect with strokes and dasharray, gradients (linearGradient + stop), `<foreignObject>` still stripped, full agent-authored architecture-diagram round-trip.

## v0.19.2 — 2026-05-15

Two real bugs surfaced when shipping the v0.19.1 showcase note + testing `wait_for_pick` on a multi-process setup.

### Fixed
- **Sync push truncated notes with nested `<article>` elements.** `extractBodyHtml` in `src/core/sync.ts` used a non-greedy regex (`<article...>([\s\S]*?)</article>`) that stopped at the FIRST nested `</article>` instead of the wrapper's. Notes with agent-authored `<article>` elements (iteration cards, blog-style sections) got truncated at the first inner close on push; cloud-served renders were ~half the size of local. Fix: use `lastIndexOf('</article>')` to find the wrapper's true close — the template emits exactly one wrapper article after the agent body, so `lastIndexOf` is unambiguous. Other sites with the same regex pattern (`finalizeLive`, `finalizeIteration`, viewer + cloud iteration splices) still use non-greedy — they're inside `.replace()` callbacks where the truncation would be visible differently; sweep deferred to a follow-up.
- **`wait_for_pick` never resolved on cross-process picks (the "wait_for_pick zawisł" report).** The SSE hub's only change-detection path was `fs.watch`. Within a single process the in-process `publish()` fast path covers writes, but across processes (MCP server's agent runs `wait_for_pick`; viewer process appends the pick on user click) the only bridge is `fs.watch` — which on macOS is flaky enough to swallow rapid events. Fix: every channel with active subscribers now also runs a 500ms polling `drainAndEmit`. `fs.watch` + direct `publish()` stay as fast paths; the poll guarantees delivery within ~500ms even when both miss. Offset check inside `drainAndEmit` prevents duplicates when more than one path observes the same append. Timer is `unref()`'d so it never keeps the process alive past explicit unsubscribe.

### Tests
- `tests/extract-body-html.test.ts` (new, 6 tests) — covers simple bodies, nested articles (single + deeply nested), missing wrapper fallback, the exact showcase-note shape that broke.
- `tests/sse-hub-polling.test.ts` (new, 4 tests) — simulates cross-process appends via direct `fs.appendFileSync` (skipping `publish()`); verifies single + multiple sequential pickups within the poll interval, no-duplicate guarantee, and that unsubscribe stops both the watcher and the poll timer.

## v0.19.1 — 2026-05-15

New MCP tool `wait_for_pick` — closes the manual seam in the iteration workflow. Before: agent calls `propose_round`, waits for the user to type "kliknąłem" in chat, then calls `iteration_state`. After: agent calls `propose_round` then `wait_for_pick({note_id, for_round: N, timeout_s: 60})`, which blocks on Folio's SSE hub until the user clicks a variant and resolves with the winning `variant_id` directly. Tool count: 19 → 20.

### Added
- **`wait_for_pick` MCP tool.** Long-polls Folio's `src/core/sse-hub.ts` for `kind:pick` entries on the given note. Race-window safe: pre-subscribe state check returns immediately if the round is already picked (covers the case where the user clicks between `propose_round` returning and `wait_for_pick` getting called). Returns `{picked: true, variant_id, round}` on success or `{picked: false, timeout: true, current_round}` on timeout. Default timeout 60s; clamped to [1s, 300s].
- **SKILL section "Iteration notes (v0.18.0+)"** restored + updated with the new `wait_for_pick` workflow as the load-bearing usage pattern.

### Architecture
- Single new function in `src/core/iteration.ts`; thin dispatch case in `src/mcp/server.ts`. No schema migration. Builds on the SSE hub Folio already maintains for live notes (`subscribe` + `publish`); the iteration `pickVariant` writer was already calling `publish`, so no producer-side changes needed.
- Finalized notes return `{picked: false}` (not the lineage) — finalize archives the JSONL to `.trash/`, so the lineage isn't reachable through this API; agent should switch to reading the compiled body_html. Locked-in via test.

### Tests
- `tests/iteration-wait.test.ts` (new, 10 tests) — covers SSE pickup of matching round, filtering on `for_round`, ignoring non-pick entries, fast-path immediate returns (already picked, finalized), timeout shape, error paths, and an end-to-end MCP integration via `buildServer()`.

## v0.19.0 — 2026-05-15

Capability URL sharing now has a viewer UI. Previously: CLI (`folio publish`) and MCP tool (`publish`) only — viewer notes had no Share button at all, so anyone using only the local viewer didn't know the feature existed. Designed in two rounds via the v0.18 iteration primitive (B · topbar-popover → B3 · minimal+manage-link). Three placement concepts compared, three popover variations refined, picked one direction, shipped.

### Added
- **Topbar `↗ Share` button on note pages.** Opens a popover with the same form fields as the CLI (`expires_in_days`, `max_views`, optional `recipient`). On submit, calls a new viewer-side proxy endpoint that forwards to the cloud's `/v1/share`. Result URL renders inline with copy + revoke buttons. Outside-click / Esc dismiss the popover.
- **Active-shares indicator.** Orange dot beside the Share label lights up when the note has live capability URLs — at-a-glance signal that the note is already published somewhere. Count comes from a GET fired on page load (silent failure when cloud is unreachable).
- **`/n/:id/shares` manage page.** Full list view linked from the popover's `manage →` bar. Each share rendered as a card with URL (with copy), created/expires dates, view counter (`N / max` or `N / ∞`), recipient hash (truncated), and a revoke button. Empty + not-paired states inline. Reached from the popover, not navigation — discovered after first publish.
- **Three new viewer API endpoints** — `POST /api/notes/:id/shares`, `GET /api/notes/:id/shares`, `DELETE /api/notes/:id/shares/:token`. Auth comes from `~/Folio/.sync-state.json` (same source the CLI uses); recipient email is hashed locally before the cloud sees it. Not-paired returns 412 with structured `{code: "NOT_PAIRED"}` so the UI can guide the user to `/cloud`.

### Tests
- `tests/viewer-shares.test.ts` (new, 11 tests) — covers unpaired states for all three verbs, full paired round-trip against an in-process mock cloud, recipient hashing, note page topbar markup, manage page empty / populated / unpaired renders.

## v0.18.2 — 2026-05-15

### Fixed
- **Arbitrary `data-*` attributes survived only on Folio's own elements.** The sanitizer's global allow-list listed specific `data-folio-*` + `data-entry-id` entries but no wildcard, despite a comment in the code claiming "arbitrary data-* for agent-built interactive widgets". Agents wiring static markup to inline JS via `data-tab` / `data-panel` / `data-foo` hooks had those attrs silently stripped at create time — JS handlers then read `null` from `getAttribute('data-tab')` and broke. First-hand observation: tabs in the public-sharing interactive guide didn't switch. Sanitizer config switched to a `data-*` wildcard (via sanitize-html's native syntax); existing Folio-internal hooks (`data-folio-content`, `data-folio-live-feed`, `data-entry-id`, etc.) continue to work as before. Two regression tests added: arbitrary `data-tab` / `data-panel` / `data-foo` survive; Folio-internal `data-folio-*` still survives.

### Known limitations (documented, not changed)
- **Boolean attributes without values** (`<section hidden>`, `<button disabled>` when used purely as a flag) are stripped by sanitize-html upstream. Agents needing initial-hidden state should use a CSS class (`.is-hidden { display: none }`) or write the attribute with an explicit value (`hidden="hidden"`). Test added so the behavior is locked in.

## v0.18.1 — 2026-05-14

### Fixed
- **Cloud `/raw/:uuid` 500 on every note** for clouds first installed at v0.13–v0.14. The v0.17 `inline_render` column-add lived inside the v0.12→v0.13 UNIQUE-rebuild branch in `ensureMultiUserSchema`, behind an `if (hasNewUnique) return;` early-return. Clouds created with the v0.13+ schema directly (multi-user UNIQUE present from day one — e.g. `folio.notibox.ai`) skipped the rebuild → never ran the ALTER → every `/raw/:uuid` SELECT failed with `no such column: inline_render`. Migrator restructured so the inline_render block now runs on every boot, after any rebuild path. Regression test in `tests/cloud-multi-user-migration.test.ts` reproduces the v0.13-era seed shape and asserts the column lands.

### Hotfix without upgrade
Affected operators can patch in place: `sqlite3 <cloud.db> "ALTER TABLE notes ADD COLUMN inline_render INTEGER NOT NULL DEFAULT 0;"` then restart the service. v0.18.1 fixes it for new boots; the hotfix is idempotent with the migrator.

## v0.18.0 — 2026-05-14

New note type primitive: **`iteration`** — for design-iteration workflows where the agent generates N candidates, the user clicks one, the agent generates N variants of the pick, repeat. Tree-shaped (every variant has a `parent_variant_id` pointing at the round-winner that spawned it), append-only on the live-entries JSONL substrate.

### Added
- **`iteration` note type.** `create({ type: "iteration", title, body_html, thread_id })`. body_html is chrome only (h1 + intro); variants live in entries, not in body.
- **Three new MCP tools** — `propose_round({ note_id, variants[], parent_variant_id? })` returning `{ round, variant_ids[] }`; `pick_variant({ note_id, variant_id })` returning `{ round, variant_id, rejected_variant_ids[] }`; `iteration_state({ note_id })` returning `{ rounds[], lineage[], current_round, is_finalized }`. Tool count: 16 → 19.
- **Gallery renderer.** Viewer `/raw/:id` for iteration notes swaps the article body for a server-rendered grid of variant cards, each in its own sandboxed sub-iframe so per-variant CSS/JS stays isolated. Click-to-pick wired via parent-iframe `postMessage` → `POST /api/notes/:id/iter/pick` → iframe reload. Empty / waiting / multi-round breadcrumb states all handled.
- **Cloud-side rendering.** Cloud `/raw/:uuid` renders the same gallery but read-only (no pick buttons, no click handlers — picks happen on the device that owns the note). Iteration entries now sync to cloud via the existing `live_entries` push pipeline.
- **`finalize` for iteration notes.** Compiles the picked lineage into a static artifact (Final design block + Iteration history list), archives the JSONL (including discarded variants) to `~/Folio/.trash/`. Permissive — finalize with no picks writes a "no design selected" stub instead of erroring, mirroring `finalizeLive` behavior on empty notes.

### Migration / compatibility
- No schema migration. Iteration notes reuse the v0.9 `live_entries` JSONL + cloud table.
- Sync push query updated: previously gated on `live = 1`, now also pushes notes WHERE `type = 'iteration'`. Cloud's accept path was already type-agnostic — no cloud changes required for sync.
- Existing live notes / journal / snippet / research / comparison / technical flows are unchanged.

### SKILL
- New "Iteration notes" section with workflow, tool surface, and labeling guidance.
- `iteration` row added to the type-selection table.

## v0.17.2 — 2026-05-14

### Fixed
- **Auto-delete banner only when ≤7 days from expiry.** Previously it showed for every non-final note from creation (29d → 1d), so users learned to ignore it. The 7-day threshold matches `list_expiring` and the topbar "Expiring 7d" chip — the banner is load-bearing again.
- **Bouncy few-px scrollbar on note pages.** `.note-shell` / `.note-side` / `.note-main` assumed a 60px topbar but actual height can be 64-65px depending on font rendering. `body.note-page` now has `overflow: hidden`; the iframe wrap + side panel each scroll internally so nothing legitimate is hidden.

## v0.17.1 — 2026-05-14

Drop the silly `<button>` strip + adjacent form-control bans. Sanitizer was being conservative-by-default in a setup where the actual threat model already neutralizes the entire class of risk: notes render in a sandboxed null-origin iframe with `form-action 'none'` + `connect-src 'none'` + `on*` handlers stripped. Static `<button>` is no different from `<div>` for security purposes; the createElement workaround was security theatre.

### Added (sanitizer allow-list)
- **Form controls in static HTML:** `<button>`, `<input>`, `<select>`, `<option>`, `<optgroup>`, `<textarea>`, `<label>`, `<form>`, `<fieldset>`, `<legend>`, `<output>`, `<progress>`, `<meter>`. With pragmatic attribute allow-lists (`type` / `name` / `value` / `disabled` / `placeholder` / `required` / `min` / `max` / `step` / `pattern` / etc.).
- **Accessibility attrs:** `role`, `tabindex`, `title`, `hidden`, and 25 standard `aria-*` attributes allowed globally on any element. Screen reader support for interactive widgets, no asterisks needed.

### Docs
- **SKILL.md** + **STYLEBOOK.md** updated — old "build via createElement" workaround for form controls replaced with the natural static-HTML pattern. SKILL example now shows a button + input directly in body_html with click handler in `<script>`.
- **MCP `create` tool description** updated — previously claimed `<style>` was forbidden (stale since v0.15) and didn't mention form controls. Now accurate.

### Safety check

Triple-locked threat model is unchanged:
- Sandboxed null-origin iframe (no `allow-same-origin`) — no parent reach, no cookies, no localStorage
- CSP `form-action 'none'` — submissions blocked at the policy layer, regardless of `action` attribute
- CSP `connect-src 'none'` — fetch/XHR/WebSocket all blocked, so runtime-built code can't exfil either
- `on*` handler attributes stripped by sanitize-html as before

`<button>` and friends are structural elements with zero exfil surface in this configuration. They've been on the SKILL's "build via JS" workaround list since v0.3 with no actual security justification.

## v0.17.0 — 2026-05-14

**Inline-rendered live notes** — entries render INSIDE body_html (not in a side panel). The note body grows as you append. Cloud-side runtime changes — VPS deploy needs `sudo ./deploy/update.sh`.

### Added
- **`create({live:true, inline:true})`** — new flag on MCP `create` + CLI `folio new --inline`. Side panel is suppressed for inline notes; entries appear directly in the note document. Body_html should contain a `<section data-folio-live-feed></section>` placeholder where entries land; if omitted, Folio auto-injects one at the end of body. `inline` is ignored when `live=false`.
- **Server-side entry compile.** Local viewer `/raw/:uuid` and cloud `/raw/:uuid` both splice the current feed into `<section data-folio-live-feed>` on every GET. Recipient opens the note — sees all entries immediately, even without a SSE-connected chrome. New entries during the session arrive via SSE → parent → postMessage → body iframe.
- **`src/core/feed-render.ts`** — shared helper (`renderEntryHtml`, `renderFeedHtml`, `spliceFeedIntoBody`, `INLINE_FEED_BOOTSTRAP_JS`) used by both `finalize()` and the inline `/raw/` path. Single source of truth for the entry HTML shape.
- **Schema v3 → v4** — `notes.inline_render INTEGER NOT NULL DEFAULT 0`. Local viewer migration in `src/core/migrations.ts`; cloud-side ALTER ADD COLUMN in `ensureMultiUserSchema()`. Sync push/pull payloads carry `inline_render` so the flag rides along to phone PWA and back.
- **Sanitizer allows `data-folio-live-feed`** (and `data-entry-id`) on any element so the placeholder + compiled entry articles survive `sanitize-html`.

### Fixed
- **SKILL clarity around live note UX.** SKILL.md "Live notes" section now states "Two render modes" and walks the agent through picking inline vs panel. Adds an explicit rule: don't tell the user "feed refreshes via SSE" without saying WHERE (body vs side panel) — that's where humans get confused.

### Notes for operators

Cloud-side runtime change — `sudo ./deploy/update.sh` on the VPS. Existing live notes default to panel mode (`inline_render=0` from the migration). To upgrade a note to inline, recreate it with `inline:true` and re-append the entries — schema is append-only so there's no in-place flip. Most new live notes (journal, todo, log) should default to inline.

## v0.16.0 — 2026-05-14

Three polish items around sharing + branding. Cloud-side runtime changes — VPS deploy needs `sudo ./deploy/update.sh` for the new `/p/<token>/og.svg` + `/qr.svg` routes.

### Added
- **Favicon for local viewer.** New routes `/favicon.svg` + `/favicon.ico` (both serve the same SVG with `image/svg+xml`), `<link rel="icon">` + `<link rel="apple-touch-icon">` injected into the viewer `shell()` template. Brand icon ("f" + orange dot, square, 96px corner radius) extracted to `src/core/brand.ts` so favicon + PWA icon never drift. Fixes the `GET /favicon.ico 404` console noise.
- **Open Graph image for shared notes.** New module `src/cloud/og.ts` generates a 1200×630 SVG card with the note title, scope chip (`note` / `thread`), theme-accent stripe down the left edge, and the `folio.` wordmark in the bottom-left. Served at `/p/<token>/og.svg`. `renderSharedNotePage` + `renderSharedThreadPage` inject the full OG meta set: `og:title` / `og:type` / `og:image` (+ dimensions + image:type) / `og:url` / `og:site_name`, plus `twitter:card=summary_large_image`. Slack / Telegram / iMessage / Discord / Twitter unfurl the link with a real preview instead of a bare URL.
- **QR code for capability URLs.** New module `src/cloud/qr.ts` (wraps the `qrcode` npm package in SVG-string mode, brand-colored ink/bg). Served at `/p/<token>/qr.svg`. `folio publish` output gains a `QR code` line pointing at the URL — paste it in chat or open in browser, scan with phone camera, lands on the share page.

### Notes for operators

Cloud-side runtime change — `sudo ./deploy/update.sh` on the VPS. Existing share links continue working unchanged; the new routes layer on alongside.

Recipient-bound shares: `og.svg` is publicly fetchable so social previewers can render the unfurl card (otherwise the link preview shows just the URL string). The note title surfaces in the OG, matching Notion / Google Docs behaviour where the title leaks via link preview but content stays behind the email confirmation gate. If a future use case wants to suppress title for bound shares, gate `og.svg` in `handleCapabilityRoute` on cookie state.

## v0.15.1 — 2026-05-14

Two follow-ups to v0.15.0.

### Fixed
- **`window.print()` / `alert()` / `confirm()` / `prompt()` now work inside notes.** All three note-iframe spots (local viewer, capability URL render, PWA `/n/:uuid` shell) gain `allow-modals` in their `sandbox` attribute. Without it, Chromium silently logs "Ignored call to 'print()'. The document is sandboxed, and the 'allow-modals' keyword is not set." Sanitizer's `DEFAULT_IFRAME_SANDBOX` updated to match for body-embedded iframes. Threat model unchanged — modals can annoy but can't exfiltrate (CSP `connect-src 'none'` still holds; null-origin sandbox still holds). SW bumped to `folio-pwa-9` to evict cached `/n/:uuid` HTML with the old sandbox attr.

### Docs
- **`skills/folio/SKILL.md`** updated for the plain theme that landed in v0.15.0:
  - New `plain` row in the theme matrix (custom layout / poster / ASCII art / experimental viz)
  - `<style>` rule softened from strict `❌` to `⚠️ — allowed since v0.15 but default to theme.css classes; reach for a body-level <style> block only when plain is in play or utilities don't fit`
  - `style=` rule notes the `plain` exception

## v0.15.0 — 2026-05-14

`plain` theme — almost-bare canvas for notes that want their own visual identity. Sanitizer now preserves `<style>` blocks at body level, so agents can write idiomatic HTML with a local stylesheet inside the note. No cloud-side runtime changes — pure local + skill update; the cloud just serves whatever the agent put in body_html.

### Added
- **`themes/plain/`** (new bundled theme). 60 lines of `theme.css`: CSS reset, body padding, fluid headings, sensible defaults for `<table>` / `<pre>` / `<code>` / `<blockquote>` / `<img>`, dark-mode pairing via `@media (prefers-color-scheme: dark)`. **No** `.eyebrow` / `.lead` / `.card` / `.cards` / `.pill` / `.verdict` — that's the point. Agent owns the per-note visual identity.
- **`<style>` tag allowed at body level** (`src/core/sanitize.ts` ALLOWED_TAGS). Notes render in a sandboxed null-origin iframe with `connect-src 'none'`, so CSS injection is bounded — no network exfiltration, no parent-window reach. Inline `style="..."` attrs were already allowed; this is just a smaller, more idiomatic surface for the same capability.
- **STYLEBOOK update** in `skills/folio/SKILL.md` / `STYLEBOOK.md`: new "Plain" entry in the theme tone matrix + expected pattern (a `<style>` block at the top of body_html). Old `❌ <style> in body_html` rule downgraded to `⚠️ — use sparingly, prefer theme.css classes for non-plain themes`.

### When to use the plain theme

The agent should reach for `plain` when the user asks for something visually idiosyncratic — a poster, a fake terminal, a custom diagram, an ASCII map, an experimental data viz — anything the standard utility classes would fight rather than support. For `research` / `comparison` / `technical` / `journal` shape the existing themes (`linen` / `folio` / `newsroom` / …) still win — they keep the user's Folio visually coherent across notes.

### Safety note

The threat model is unchanged. Every note still renders inside a sandboxed null-origin iframe with `script-src 'self' 'unsafe-inline' https:` + `connect-src 'none'` + `frame-ancestors 'self'`. CSS in body-level `<style>` can't fetch external URLs that would leak data (CSP blocks `background: url(...)` to non-same-origin), can't reach the parent window's DOM, can't read cookies or localStorage. The creative freedom is creative, not security.

## v0.14.0 — 2026-05-14

Operator UI for the multi-user cloud. Every CLI subcommand (`folio cloud user-add / user-rename / user-revoke / user-promote / pair-code --user`) now has a clickable equivalent in the local viewer's `/cloud` page, gated by `users.is_operator`. Six new HTTP endpoints + a viewer proxy + a PWA identity hint. Cloud-side runtime changes — VPS deploys need `sudo ./deploy/update.sh` and an explicit `folio cloud user-promote <id>` to designate the first operator.

### Added
- **`users.is_operator INTEGER NOT NULL DEFAULT 0`** column (v4 → v5 migration, idempotent ADD COLUMN on pre-v14 DBs). New CLI: `folio cloud user-promote <id>` / `user-demote <id>`. Display surfaced in `user-list` "role" column (operator / active / deleted). Multiple operators allowed.
- **`/v1/admin/*` operator endpoints.** `GET /whoami` (any device, returns user_id + display + is_operator). Operator-only: `GET /users` (global per-user breakdown), `POST /users` (create + optional first pair-code), `PATCH /users/:id` (rename · promote · demote · reactivate), `DELETE /users/:id[?purge=1]` (revoke / cascade purge), `POST /users/:id/pair-code` (mint for target user). Non-operator devices get `403`. All mutations share code with the CLI subcommands via the new `src/cloud/admin.ts` module.
- **Viewer proxy `/api/cloud/admin/*`.** Same bearer-laundering pattern as `/api/cloud/stats`: the viewer process holds the token from `.sync-state.json` and forwards the request body. Page JS calls these with no Authorization header.
- **Operator dashboard in `/cloud`.** Local viewer's `/cloud` page calls `/api/cloud/admin/whoami` on load and renders the new Operator panel only when `is_operator=true`. Click a user row to expand a detail panel (stats grid + actions: mint pair-code, rename, promote/demote, revoke devices, purge cascade). `+ Add user` opens an inline form with the option to mint the first pair-code in the same request. Purge requires typing the user id as a confirmation gate.
- **PWA identity hint.** Top bar now shows `signed in as <display> · sign out` once the bearer is in IndexedDB. Tap "sign out" → confirms → clears IDB token + caches → redirects to `/pair`. SW version bumped to `folio-pwa-8`.

### Notes for operators

After deploying v0.14.0, designate the first operator (otherwise the new admin endpoints return 403 for everyone):

```bash
sudo -u folio /opt/folio/folio cloud user-promote jarek
```

From that point on, the local viewer's `/cloud` page shows the operator panel for that user's devices — no more SSH needed to onboard new accounts. The CLI subcommands keep working (single source of truth in `src/cloud/admin.ts`), so either path is fine.

## v0.13.1 — 2026-05-14

Hotfix for v0.13.0's CLI dispatcher: top-level `parseArgs` consumed `--flag value` pairs into `flags` before dispatch, so `folio cloud pair-code --user alice` reached `cloudCmd` with no flags and errored with "--user required". Local tests passed because they called `cloudCmd` directly; only the actual binary invocation triggered it.

### Fixed
- **`folio cloud <sub> --flag …` now reaches the subcommand handler.** Dispatcher reconstructs `--flag value` and bare `--flag` pairs from `flags` and appends them to `cloudCmd`'s args. Affects every cloud subcommand that takes flags (`pair-code --user`, `user-add --display`, `user-list --json`, `user-revoke --purge --yes`). New regression test in `tests/cloud-user-cli.test.ts` drives through `main()` end-to-end.

## v0.13.0 — 2026-05-14

Multi-user cloud relay. One `folio.notibox.ai` instance now serves any number of independent users — each user pairs their Notibox + laptop + phone, and the cloud filters every read/write by user_id so accounts are invisible to each other. Cloud-side runtime changes — VPS deploys need `sudo ./deploy/update.sh`. Existing v0.12 paired devices keep working: the migration auto-runs and backfills to a single `default` user, which the operator can rename via the new CLI.

### Added
- **Multi-user partitioning across the cloud DB.** New `users` table; `user_id NOT NULL` column on devices / pairing_codes / notes / assets / tombstones / shares. Every authed query in `src/cloud/server.ts`, `sync.ts`, `shares.ts`, `stats.ts` now filters by `device.user_id` derived from the bearer. UNIQUE on notes flipped from `(thread_id, slug)` to `(user_id, thread_id, slug)` — Alice and Bob can both have a `morning` thread. Cross-user push/pull/raw/feed/admin-stats/share returns "not found" symmetrically (no leakage of uuid existence).
- **Idempotent v0.12 → v0.13 migrator** in `cloudDb()`. PRAGMA `table_info(devices)` canary detects pre-v0.13 schemas; `ALTER TABLE ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default'` fills every existing row in one statement; notes table rewritten under `PRAGMA foreign_keys = OFF` to swap the UNIQUE constraint without cascading the `note_tags` + `live_entries` FKs. Defensive: bails with a diagnostic if duplicate (user_id, thread_id, slug) groups would block the rebuild.
- **Per-user asset namespace.** New public route `GET /u/<user>/t/<thread>/asset/<file>` pins lookup to `assets.user_id`. `renderStandaloneNote` rewrites body_html refs `/t/<thread>/asset/<file>` → `/u/<user>/t/<thread>/asset/<file>` on serve so iframes always load the right user's bytes. Legacy `/t/<thread>/asset/<file>` route preserved for single-tenant compat — resolves only when exactly one user owns the (thread, filename) tuple, else 404. SW version bumped to `folio-pwa-7` to invalidate cached old-shape URLs.
- **CLI `folio cloud user-*`** (operator, server-side). Four new subcommands:
  - `folio cloud user-add <id> [--display "Name"]` — provision a new account. Kebab-case validation, idempotency, `--reactivate` flag for previously-deleted ids.
  - `folio cloud user-list [--json]` — per-user table: devices, notes, live entries, assets (count + bytes), shares, last seen. Operator's whole-cloud view, not exposed via HTTP.
  - `folio cloud user-rename <old> <new>` — atomic rename across all six user_id columns + the users row. Bearer tokens unaffected.
  - `folio cloud user-revoke <id> [--purge --yes]` — without flags, revokes all user's devices (data preserved). With `--purge --yes`, cascades delete on notes/assets/tombstones/shares + sets `users.deleted_at`. Confirmation gate requires explicit `--yes` to avoid accidental data loss.
- **`folio cloud pair-code --user <id>`** required when more than one user exists. Single-user installs keep the v0.12 invocation (no flag). Mints codes with `pairing_codes.user_id` set; consuming a code stamps the new device into that user's namespace.
- **Per-user `/v1/admin/stats`.** HTTP endpoint scoped to caller's user; Alice and Bob each see only their own counts. Operator CLI `user-list` retains the global view.

### Security
- **Cross-user push rejection.** `handlePush` ownership checks on every note/live_entry/delete: foreign-uuid pushes silently skipped (idempotent); cross-user live_entries fail the owner check; cross-user deletes log nothing and pass through unchanged. A leaked bearer can only damage its own user's data.
- **Capability URLs pinned to share.user_id.** Note/asset lookups behind `/p/<token>/...` join on `share.user_id` so a leaked token from user A can never resolve to user B's note even if a uuid collision is engineered.
- **`/v1/auth/devices` and `/v1/auth/device/:id` revocation** scoped to caller's user. Operator does cross-user revoke via the CLI, never via the API.

### Notes for operators

```bash
# 1. Deploy (replaces binary, restarts service, runs migration on first DB open)
sudo ./deploy/update.sh    # or manually: install -m 755 folio /opt/folio/folio + restart

# 2. Verify migration
sudo -u folio /opt/folio/folio cloud user-list
# → default | display=default | 1 device | N notes | ...

# 3. Rename the seeded user (optional — keeps things readable)
sudo -u folio /opt/folio/folio cloud user-rename default jarek

# 4. Add a new user
sudo -u folio /opt/folio/folio cloud user-add alice --display "Alice"
sudo -u folio /opt/folio/folio cloud pair-code --user alice
# → hand the 6-digit code to Alice over Signal / SMS / phone

# Alice pairs (her own machine)
folio sync pair --remote https://folio.notibox.ai --code <code>
```

Existing v0.12 clients keep syncing without changes — they never see any user_id in the wire protocol; the cloud derives it from the bearer. Capability URL recipients (no Folio install) are unaffected; URLs continue to work cross-user.

## v0.12.0 — 2026-05-14

Multi-feature polish: install UX, observability, asset pull, real email delivery. Cloud-side runtime changes — VPS deploys need `sudo ./deploy/update.sh` to pick up `/v1/admin/stats`, plaintext-email passthrough on `/v1/share`, and the new PWA install banner. Optional email setup: set `RESEND_API_KEY` + `FOLIO_MAIL_FROM` on the cloud to wire outbound delivery; without them the share endpoint still works and reports `email_skipped="no-mailer"` so the CLI can surface a clear status line.

### Added
- **iOS / Chrome / Edge install banner.** PWA home page now captures `beforeinstallprompt` on browsers that fire it (Chrome/Edge/Samsung) and shows an inline `Install` button. iOS Safari — which doesn't fire that event — gets a dedicated hint: "Tap the Share icon, then 'Add to Home Screen'." Hidden whenever the app is already running standalone (`display-mode: standalone` or legacy `navigator.standalone`); dismissible for the session. SW bumped to `folio-pwa-6`.
- **`GET /v1/admin/stats` (authed) + viewer Cloud stats panel.** Read-only observability snapshot: note/live-entry/asset/share/tombstone counts, DB + asset bytes, per-device `last_seen_at` / `last_pushed_at` / `note_count`, top 20 threads. Local viewer's `/cloud` page gets a new "Cloud stats" card that fetches this when paired, with a refresh button. Bearer token never leaves the local process — viewer proxies via `GET /api/cloud/stats`.
- **Pull-side asset download.** When `syncOnce` pulls a foreign-origin note, the daemon scans its `body_html` for `/t/<thread>/asset/<file>` refs and downloads any bytes missing locally via the cloud's public asset endpoint. Sync output gains `assets_pulled=N`. Idempotent (existing non-empty files skipped) and validated against the same `isSafeAssetFilename` allowlist used on push.
- **Real email delivery for `folio publish --recipient`.** Cloud relay now ships a pluggable mailer (`src/cloud/mailer.ts`) with two providers: **Resend** (HTTP-only — no SMTP lib dep; set `RESEND_API_KEY` + `FOLIO_MAIL_FROM`) and **console** (opt-in dev logger via `FOLIO_MAIL_DEV=1`). `POST /v1/share` accepts `recipient_email` plaintext alongside the existing `recipient_email_hash`; server derives + persists only the hash and uses plaintext for the outbound message. Response includes `email_sent` / `email_skipped` / `email_error` so the CLI can show a clear status line. Mismatched hash/plaintext pairs are rejected. Recipient confirmation flow (HttpOnly cookie gate) is unchanged.

### Improved
- **Sync output adds asset direction arrows** — `assets↑=N` (pushed) `assets↓=N` (pulled) in the daemon's per-iteration log line and the local `/cloud` page's sync result panel. Easier to tell at a glance whether you're publishing or consuming bytes on a given run.
- **Cloud stats endpoint is on every release** — even before paging numbers matter, the per-device "last push / last seen" view makes it trivial to spot a phone that's been offline for weeks or a revoked laptop still listed.

### Notes for operators

Production VPS needs `sudo ./deploy/update.sh` to pick up the cloud changes. To enable outbound email, add to `/etc/folio-cloud/folio-cloud.env`:

```
RESEND_API_KEY=re_yourkeyhere
FOLIO_MAIL_FROM=Folio <folio@yourdomain.tld>
```

Then `sudo systemctl restart folio-cloud`. The Resend "From" domain has to be verified in Resend first — otherwise sends fail and the CLI surfaces the API error. Skipping these vars leaves the share endpoint fully functional minus delivery; capability URLs work as before.

## v0.11.0 — 2026-05-14

Multi-device + sharing maturity. Five post-MVP backlog items + token-hygiene polish. This release has cloud-side runtime changes — VPS deploys need `sudo ./deploy/update.sh` (or a re-run of `bootstrap.sh`) to pick up SSE forwarding, tombstones, recipient binding, and asset cascade.

### Added
- **Cross-device delete tombstones.** Delete on laptop A used to leave laptop B's local copy intact (pull silently missed the gap past the cursor). Cloud now keeps a `tombstones` table, pull returns rows since the caller's cursor, and `applyPulledTombstones` calls `storage.deleteNote` on foreign-origin entries. Own-echo skipped via `origin_device_id`. Sync output gains `deletes_applied=N`.
- **Live note SSE forward through cloud.** New `GET /v1/sync/live-stream?note_uuid=<uuid>` endpoint with `text/event-stream` fan-out from `handlePush.live_entries`. Token accepted via Bearer header OR `?token=` query param (EventSource limitation). PWA `/n/:uuid` shell auto-opens the stream when `X-Folio-Live: 1` is set on `/raw/`, renders a live panel below the iframe. New entries appear in real time with pulsing-orange indicator. Heartbeat every 25s keeps proxies happy.
- **`folio publish --recipient bob@example.com`.** Capability URL bound to a SHA-256 hash of the recipient's email. First visit hits a confirmation form; on email match, server sets a path-scoped HttpOnly cookie. Plaintext email never leaves the publishing client. Reduces blast radius of a leaked URL — both URL and email need to leak before content shows.
- **`deploy/bootstrap.sh`** — one-shot self-host bootstrap. `curl | sudo PUBLIC_URL=https://cloud.example.com bash` downloads the latest release for the target triple, runs `install.sh`, writes the systemd drop-in, generates the first pairing code, and prints the Caddy snippet to paste. Subsequent device pairings still go through `/cloud` UI without SSH.
- **Asset cleanup cascade on delete.** When `handlePush.deletes` removes a note, the cloud scans referenced assets and unlinks any blob with zero remaining referrers (LIKE-scan on body_html across all active notes). Storage reclaim is automatic; `accepted.assets_deleted` in the push response reports what went.

### Improved
- **Token hygiene at pair time.** `~/Folio/.sync-state.json` is now written with `mode 0600` (atomic-rename preserves it). `folio sync pair` output shows only a `AvAE…glEQ` fingerprint instead of nudging the full bearer onto a screen-share or paste-to-chat trap.
- **Release flow documented** with the canonical bump → push branch → PR → merge → pull → tag sequence in CONTRIBUTING.md. Branch protection rationale spelled out (kept on `main`, paid off when an accidental `git add -A` snuck a pnpm-lock.yaml in).

### Notes for operators

Production VPS needs `sudo ./deploy/update.sh` to pick up the cloud changes. Existing v0.10.x clients keep working against a v0.10.x cloud (the new pull tombstones field is optional in the typed response), but you'll want the new endpoints for SSE + recipient binding to actually function.

## v0.10.2 — 2026-05-14

Maintenance + dev-loop quality. No cloud-side runtime changes; existing VPS deploys don't need an update for this release. Local binary picks up:

### Added
- **Playwright PWA test suite.** `bun run test:pwa` drives a real headless Chromium against a real cloud relay, exercises the pair flow, IDB token plumbing, blob-URL iframe handshake, and sandbox attribute integrity. Catches the class of bugs that took multiple deploy/redeploy cycles during W3.
- **`folio doctor` storage + cloud sections.** Bumps install-state-only doctor to a full diagnostic: `folio_home` / `index.sqlite` / bundled themes existence, plus (when paired) cloud reachability, token validity, last-push recency. `--offline` skips network probes; `--json` machine-readable. Auto-emits warnings for unreachable cloud, revoked token, stale (>7d) sync.
- **Upgrade-path integration tests.** `tests/migrations.test.ts` now covers v0.9.1 → v0.10.x (the W2 origin/owner_device_id migration) end-to-end with byte-for-byte previous-version db construction. Plus a v0.8.0 → v0.10.x hop test that exercises both migrations in order. Codifies the regression-test pattern for future schema work.
- **Pre-release maintainer checklist** in CONTRIBUTING.md — seven items including the "first-time-user walkthrough" pass that would have caught delete + TOC + sync UI + print bugs before they hit users.

### Fixed
- **Print outputs only the note body.** Sidebar's "↗ Print / PDF" used to print the full viewer chrome (topbar, sidebar). Now parent posts `{ns:'folio',type:'print'}` to the iframe, which prints itself — clean PDF export.

### Docs
- README refreshed to v0.10.x feature set (cloud sync, PWA, publish, delete, doctor, sync UI). CHANGELOG.md added with v0.7.2+ entries.
- deploy/README.md gains "Test cloud changes locally first" section explaining the FOLIO_CLOUD_PORT=18081 dev-cloud workflow.
- src/core/migrations.ts header comment spells out the two-phase bootstrap discipline: new columns in migrations, new indexes in PHASE2_SCHEMA, never edit a shipped migration.

## v0.10.1 — 2026-05-13

### Added
- **`folio doctor`** extended with `Storage` and `Cloud sync` sections. Checks `folio_home` / `index.sqlite` / bundled themes + templates existence; for paired devices probes cloud reachability + token validity, tracks `last_pushed_at` recency, surfaces actionable warnings (unreachable, token rejected, stale sync). `--offline` skips network probes; `--json` machine-readable.
- **Local viewer `/cloud` page** with two modes: pair form (paste URL + code) when not paired, status + actions (sync now, generate code for new device, unpair) when paired. Backed by `/api/sync/{state,pair,pair-code,run,unpair}` endpoints — bearer token never enters page JS.
- **PWA "+ Add another device"** panel on home — generates pair codes via the new `POST /v1/auth/pair-code` cloud endpoint (authed). Closes the SSH-to-server gap for every device after the first.
- **Topbar ☁ Cloud link** in the local viewer.

### Fixed
- **Print outputs the note, not the chrome.** Previously `window.print()` printed the outer viewer (topbar + sidebar visible in PDF). Now parent posts `{ns:'folio',type:'print'}` to the iframe and the iframe prints itself — clean note-only output.

### Tests
- 270/270 unit (+6 doctor + cloud, +others)
- 6 Playwright headless-browser tests for PWA flows

## v0.10.0 — 2026-05-13

Four-weekend cloud-mvp sprint. Folio becomes a multi-device system.

### Added
- **Cloud Relay (W1).** Bun HTTP server that paired devices push notes + assets to. Bare-metal systemd deploy (`deploy/install.sh`, `update.sh`, Caddy snippet). Single binary + `ProtectSystem=strict` for blast radius comparable to a container, half the moving parts.
- **Sync daemon (W2).** `folio sync pair --remote --code` then `folio sync` as a daemon (or `--once` for cron). Bidirectional push/pull with monotonic cursors for notes + deletes + live entries. Slug collision rename on push + defensive rename on pull. Live notes are owner-locked: foreign live notes can't be appended-to locally; create your own in the same thread instead.
- **Schema v3.** `origin_device_id` + `owner_device_id` columns on notes. UUIDv7-like ULIDs already cross-device unique so no identity migration. Migration in `src/core/migrations.ts` adds the columns; PHASE2 of the two-phase bootstrap creates the index after.
- **PWA (W3).** Phone (or any browser) installs Folio from `/pair`, reads at `/`. App shell is public, contentless JS that reads token from IndexedDB → fetches `/v1/feed` for the list. `/n/:uuid` is a JS shell that explicit-fetches `/raw/:uuid` with auth header and loads it into a sandboxed iframe via blob URL — no SW dependency for auth, no race on first install. Server-side search + thread navigation + native tap-targets + offline cache via SW.
- **`folio publish` (W4).** Capability URLs at `/p/<token>/n/<uuid>` and `/p/<token>/t/<thread>/`. Token is the credential — scope-checked + expiry-checked + max_views-checked on every hit. Asset URLs in shared notes rewritten through `/p/<token>/` so images work without paired devices.
- **`folio shares list|revoke`** for managing active shares.
- **MCP `folio.publish` tool** so agents share a note inline after `create()`.
- **Asset sync.** Sync daemon scans body_html for `/t/<thread>/asset/<file>` refs, HEAD then POST missing assets to `/v1/sync/assets/<hash>`. Public route `/t/<thread>/asset/<file>` serves the bytes (sub-resource fetches from null-origin iframes can't carry bearer headers). Capability-scoped variant gates by token. Backfill scans all active notes so existing assets eventually catch up.
- **`folio delete`** (CLI + viewer sidebar button). Soft-delete to `~/Folio/.trash/` (recoverable 7 days). Sync push propagates the delete to cloud (cascade clears `note_tags` + `live_entries`). Append-only semantics preserved: agents still can't delete via MCP — this is human-only, like `finalize`.
- **TOC depth dropped to h1/h2** because three depths were visual noise. Deeper headings still get anchor IDs via `attachAnchors()` so deep-link URLs continue to work.

### Known scope cuts (post-MVP)
- Pull-side asset download (only writer→cloud direction works; multi-laptop pulls don't auto-fetch bytes)
- Cross-device delete tombstones (delete on A doesn't auto-remove on B; per-device cleanup for now)
- Live note SSE forward (phone shows last-synced snapshot, not the live feed)
- Magic-link recipient binding for shares (column reserved, not exercised)
- `folio cloud bootstrap` one-command self-host (deploy/install.sh exists; the bootstrap wrapper that wires it interactively does not)

## v0.9.1 — 2026-05-12

Hotfix for v0.9.0's upgrade-path crash. Pre-v0.9.0 dbs hit `no such column: live` because `CREATE INDEX IF NOT EXISTS notes_by_live` ran before the migration added the column.

### Fixed
- **Two-phase schema bootstrap.** `PHASE1_SCHEMA` (PRAGMAs + meta) → `runMigrations()` → `PHASE2_SCHEMA` (tables + indexes). Migrations between phases mean every column referenced by an index in PHASE2 is guaranteed to exist.
- New columns now go via `migrations.ts` `up()`; indexes referencing them live in `PHASE2_SCHEMA`. Codified as a convention in `migrations.ts` and `db.ts` header comments.

## v0.9.0 — 2026-05-12

### Added
- **Live notes (ADR-020).** Append-only journal primitive. `create({live:true})` produces a note with a sidecar `<slug>.entries.jsonl`. `folio append <id>` / MCP `append_entry` adds lines. Viewer chrome streams entries via SSE. `finalize` compiles the feed into a static body and flips the note out of live mode.
- MCP tools: `append_entry`, `list_entries`, `set_pinned`.

## v0.8.0 — 2026-05-12

### Added
- **`folio install --target openclaw`** + `--target all`. One-command install across detected MCP clients (Claude Code + OpenClaw). Atomic JSON edits with `.folio-backup-<ts>` taken on first touch.
- **`folio doctor`** (initial). Shows install state per target, warns about broken skill symlinks / stale MCP entries / multiple folio binaries on PATH.

## v0.7.2 — 2026-05-12

### Docs
- Killed the pre-v0.3 "no script in body_html" atavism in `skills/folio/SKILL.md`. Scripts are allowed at body level since v0.3; isolation comes from the outer sandboxed iframe + CSP, not the sanitizer.

## Earlier

`v0.7.x` and below: see git log for details. The repo went public on 2026-05-12 with v0.8.0 as the first announced version; v0.1 through v0.7 were the pre-public iterations.
