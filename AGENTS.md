# AGENTS.md — working ON the Folio codebase

> This file is for an agent (Claude Code, Cursor, OpenClaw, etc.) **modifying Folio's source**. If you're an agent looking for "how to use Folio as a tool" (the `create` / `search` / `suggest_thread` MCP tools, themes, output structure), read `skills/folio/SKILL.md` and `skills/folio/STYLEBOOK.md` instead.

---

## What Folio is (30 seconds)

Visual communication layer between AI agents and humans. Markdown is flat; Folio gives agents standalone HTML with theme.css so they can deliver scorecards, sidebars, color-coded findings, embedded interactive demos. Notes live as files in `~/Folio/threads/<topic>/<slug>.html`, indexed by SQLite/FTS5, served by a local Bun viewer at `http://127.0.0.1:4810`, addressable from any MCP-capable agent client via `folio-mcp` (stdio).

**Pivot v3 (ADR-009):** Folio is communication, NOT a knowledge base. Append-only (ADR-014) — agents only CREATE, never UPDATE. Iterations = new sibling notes in the same thread folder.

Strategy + ADRs are mirrored from the maintainer's Obsidian vault and intentionally not in this repo. The codebase is the source of truth — read `src/`, `themes/`, `skills/`, and tests to understand current behavior.

---

## Runtime + stack

- **Bun ≥ 1.3** (`brew install oven-sh/bun/bun`). Production binaries via `bun --compile` (see `.github/workflows/release.yml`).
- **TypeScript** — direct execution, no build step (Bun runs `.ts` natively).
- **SQLite via `bun:sqlite`** — embedded, FTS5 enabled, schema in `src/core/db.ts`.
- **Eta templates** (`*.html.eta`) — minimal template engine for `_base` wrapper around agent-supplied body_html.
- **`sanitize-html`** — agent body sanitization (`src/core/sanitize.ts`).
- **`@modelcontextprotocol/sdk`** — MCP server in `src/mcp/server.ts` (stdio transport).
- **No React, no frontend framework, no build step.** Viewer is server-rendered HTML + ~300 LOC vanilla JS injected at note view (`src/viewer/render.ts`).
- **Google Fonts CDN** for theme typography. No icon library — emoji + inline SVG only.

---

## Directory map

```
~/Projects/Folio/
├── bin/                        Executable entrypoints
│   ├── folio.ts                CLI router → src/cli/index.ts
│   └── folio-mcp.ts            MCP stdio server → src/mcp/server.ts
├── src/
│   ├── cli/                    Commander-less arg parser + commands
│   │   ├── index.ts            main(argv), routes to commands/*
│   │   ├── io.ts               ANSI color helpers, out/err/json
│   │   └── commands/           one file per subcommand
│   ├── core/                   Reusable across CLI/MCP/viewer
│   │   ├── config.ts           Paths, FolioConfig, env overrides
│   │   ├── db.ts               SQLite open + schema + logEvent()
│   │   ├── storage.ts          createNote, listNotes, searchNotes,
│   │   │                         finalize, cleanup, reindexAll, etc.
│   │   ├── sanitize.ts         body_html allowlist + iframe transformTags
│   │   ├── slug.ts             slugify, plNormalize, plStem (FTS-side)
│   │   ├── text.ts             HTML → plaintext extraction (HTMLRewriter)
│   │   ├── themes.ts           loadThemes() — no cache, fs-scan per call
│   │   ├── templates.ts        Eta wrapper — _base.html.eta + per-type
│   │   └── types.ts            NoteMeta, CreateNoteInput, etc.
│   ├── mcp/server.ts           10 tools + 6 resources (or per-thread)
│   └── viewer/
│       ├── server.ts           Bun.serve(...) — routes for /, /search,
│       │                         /threads, /n/:id, /raw/:id, /api/*, etc.
│       └── render.ts           VIEWER_CSS const + pageList/Search/
│                                 Threads/Note/Stats/Error helpers
├── templates/                  *.html.eta — wraps agent body_html
│   ├── _base.html.eta          DOCTYPE, head, meta, theme link/inline, slot
│   ├── research.html.eta
│   ├── comparison.html.eta
│   └── technical.html.eta
├── themes/                     18 themes — each has theme.css + theme.md
│   └── <name>/
│       ├── theme.css           CSS variables + utility classes contract
│       └── theme.md            Prompt addendum for agents using this theme
├── skills/folio/               OpenClaw/Claude Code Skill
│   ├── SKILL.md                Triggers + workflow + theme selection
│   ├── STYLEBOOK.md            Utility class contract + iframe + helpers
│   └── examples/<type>/        Few-shot examples per note type/theme
├── tests/                      `bun test` discovers *.test.ts
├── docs/                       Public-facing docs only
│   ├── mcp-setup.md            Agent client setup (OpenClaw, Claude Desktop, …)
│   └── wordmark-v05.html       Brand wordmark variations (10 lockups)
├── .github/workflows/          release.yml — tag push → tar.gz to GH
└── ~/Folio/                    User runtime data (NOT in repo):
                                  threads/<thread>/*.html, notes/, .trash/,
                                  index.sqlite, folio.config.json
```

---

## How to test changes

```bash
bun test                        # all 50+ tests, ~700ms
bun test tests/<file>.test.ts   # one file
bun bin/folio.ts serve          # restart viewer @ :4810
```

Tests grouped by area: `storage.test.ts`, `mcp.test.ts`, `skill-examples.test.ts`, `cleanup.test.ts`, `stemmer.test.ts`, `sanitize.test.ts`, `extend-from.test.ts` (when written).

**Use a temp `FOLIO_HOME`** in tests (mkdtempSync + env override) so they don't touch real `~/Folio/`.

---

## How to add things

### A new MCP tool

1. Append to `tools: Tool[]` in `src/mcp/server.ts` — name, description (agent-facing!), inputSchema
2. Add case to the switch in `setRequestHandler(CallToolRequestSchema, ...)`
3. Add test to `tests/mcp.test.ts` exercising the happy path + at least one error
4. If the tool is a real workflow change, update `skills/folio/SKILL.md` (which agents use to learn workflow)
5. Note the change in the commit message so it surfaces in auto-generated release notes

### A new CLI command

1. New file in `src/cli/commands/<name>.ts` exporting an async function
2. Import in `src/cli/index.ts` + add case in switch
3. Update `help()` text in same file
4. Update `README.md` "Commands" table
5. Mirror to MCP if it makes sense for agent autonomy

### A new theme

1. `themes/<name>/theme.css` — must define `:root` vars + style ALL utility classes (`.eyebrow`, `.lead`, `.pill` variants, `.card`, `.cards`, `.verdict`) + base selectors (`h1-h3`, `p`, `ul/ol`, `code/pre`, `table`, `blockquote`, `mark`, `hr`, `footer`)
2. `themes/<name>/theme.md` — agent prompt addendum: voice/structure/typography/avoid/best-for
3. Add row to theme table in `skills/folio/SKILL.md`
4. Add row to themes table in `themes/README.md`
5. Smoke test: `folio new --theme <name> ...` → open `/n/:id` and verify each element renders

Wide-chrome / narrow-prose pattern (from `themes/README.md`):
```css
:root {
  --wrap-max: clamp(720px, 92vw, 1180px);
  --read-max: 64-72ch;
}
.wrap > p, .wrap > h1-h3, .wrap > .lead, .wrap > ul/ol, .wrap > blockquote, .wrap > .eyebrow {
  max-width: var(--read-max);
}
```

### A new note type

1. Add to `NoteType` union in `src/core/types.ts`
2. Add to `ALLOWED_TYPES` in `src/mcp/server.ts`
3. Add to viewer's type-color mapping (`row .type.<name>` in `VIEWER_CSS`) + filter pill in `filterBar()`
4. Add an example under `skills/folio/examples/<name>/`
5. Optionally a typed template at `templates/<name>.html.eta` (agents can also send free-form body_html)

### A new viewer helper

Most helpers run in the parent context attaching to `iframe.contentDocument` on load. Pattern:

```js
// In src/viewer/render.ts noteScript const:
function attachMyHelper(doc) {
  doc.querySelectorAll('selector').forEach(el => {
    if (el.dataset.myBound) return;
    el.dataset.myBound = '1';
    el.addEventListener('click', () => { /* ... */ });
  });
}
// Add to onIframeLoad() body.
```

Inject CSS into iframe via `injectStyles(doc)`. Don't try to bind in the iframe document directly — outer iframe sandbox doesn't include `allow-same-origin allow-scripts` in a way that would let *our* scripts run in iframe context (and it shouldn't; agent body shouldn't run scripts).

Wait — actually outer iframe DOES have `allow-scripts` now (commit `5f0839d`) so nested iframe srcdoc JS runs. Parent JS access to iframe contentDocument also works because `allow-same-origin` is set. **Helpers attached from parent — that's the canonical pattern.**

---

## Hard rules — don't break these

- **No top-level `<script>` in body_html.** Sanitizer strips them; tests in `tests/sanitize.test.ts` enforce. Agents embed JS via `<iframe sandbox="allow-scripts" srcdoc="...">` instead.
- **`allow-same-origin` is always stripped from nested iframes** in `sanitize.ts transformTags.iframe`. Don't relax this — it's the single check preventing iframe-escape on same actual origin.
- **Append-only (ADR-014).** No `folio.update` MCP tool, no in-place note mutation. New iteration = new note in same thread folder.
- **Themes are filesystem-backed, no cache** (`src/core/themes.ts loadThemes()`). Drop folder, viewer picks it up on next request. Don't reintroduce in-memory cache.
- **Test before commit.** `bun test` must stay green. CI runs the same suite.
- **`FOLIO_HOME` env override** must work in every code path that touches `~/Folio/` (it does — via `src/core/config.ts folioRoot()`).

---

## Common pitfalls

- **`bun:sqlite` is sync.** Don't `await` it. Don't wrap in Promise unless you actually have async I/O around.
- **HTMLRewriter is streaming.** Don't expect to read body and headings in callback ordering — collect into arrays, post-process after `.transform(...)` returns.
- **Eta `<%~ %>` is raw (no escape), `<%= %>` escapes.** body_html goes in raw; user data goes escaped.
- **Sanitizer `transformTags` can return `{ tagName, attribs }` or drop the tag** by returning specific shapes. Read sanitize-html docs before adding new transforms.
- **`process.execPath` for compiled binaries.** In dev mode (`bun bin/folio.ts ...`), execPath is the Bun binary location. In compiled mode (`folio` standalone), it's the binary's own path. Code in `src/core/config.ts bundledThemesDir()` handles both.
- **Tests share `FOLIO_HOME`** if you forget `mkdtempSync`. Use the `beforeEach` pattern from existing tests.

---

## Release flow

```bash
git tag -a v0.X.0 -m "release notes inline"
git push origin v0.X.0
# .github/workflows/release.yml builds darwin-arm64 + linux-x64,
# bundles themes/templates/skills, attaches tar.gz to GH release.
```

Per `.github/workflows/release.yml` — tag triggered, ~1 min build, auto-generated commit-based release notes. Don't tag `main` without testing locally first; CI tests run after artifact build, not before (yet).

---

## Where to find things fast

- "How do agents call Folio?" → `src/mcp/server.ts` + `docs/mcp-setup.md`
- "How do agents structure HTML?" → `skills/folio/STYLEBOOK.md`
- "What's the schema?" → `src/core/db.ts` `SCHEMA_V1` const
- "What's the brand?" → `themes/linen/theme.css` (default) + `docs/wordmark-v05.html` (variations)
- "What does the viewer look like?" → `bun bin/folio.ts serve` and open `http://127.0.0.1:4810`. Source in `src/viewer/render.ts` (CSS + HTML helpers) and `src/viewer/server.ts` (routes)
- "Why is X like that?" → check commit history (`git log --oneline -- <path>`) — substantive decisions land in commit messages
