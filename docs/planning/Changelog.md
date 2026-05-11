# 📜 Folio — Changelog

> Format: jednoliniowe bullet pointy per sprint, daty po dacie zakończenia.

---

## 2026-05-11 — Sprint 0 (Planning)

- ✅ Plan projektu w Obsidian: [[Folio]], [[Architecture]], [[TODO]], [[Decisions]], [[Changelog]]
- ✅ Decyzja wstępna: stack = Bun + TS + SQLite + FTS5 + Eta templates + MCP SDK
- ✅ Decyzja wstępna: format notatek = standalone HTML files z inline metadata + theme
- ✅ Skill + MCP server zaplanowane (oba, nie alternatywa)
- ✅ Sprint plan rozpisany na 8 sprintów; MVP = S1+S2+S3+S4
- ✅ Wpis w `Projekty/INDEX.md`
- 🔜 Decyzja: ostateczna nazwa, lokalizacja storage, repo init



---

## 2026-05-11 — Pivot v2 (Communication medium, not KB)

- ✅ Krytyka v1: premise „HTML jako long-term storage" miał słabe punkty (theme migration, slop accumulation, retrieval).
- ✅ External validation: Thariq (Anthropic) publikuje „HTML is the new markdown" 2026-05-08 — silny sygnał dla HTML-first.
- ✅ Counter-perspective: Kurtis Redux pokazuje 6 słabych stron HTML-as-output (tokeny 2-4×, source readability, security, diff noise, infra burden, compliance).
- ✅ Repozycjonowanie: Folio = wizualne medium komunikacji agent↔człowiek, nie baza wiedzy.
- ✅ ADR-009 → ADR-013: pivot, variants over history, selection bridge, dwa profile renderu (50%+ token savings), cloud publish jako osobny projekt.
- ✅ Sprint plan v2: MVP komunikacji = S1+S2+S3+S4; selection loop = S5; share = S7.
- ✅ FTS5, backlinks, graph, import z Obsidian wycofane do backloga.
- ✅ Dodatkowe komponenty: selection bridge (WebSocket 4811), variants model, folio.app cloud.



---

## 2026-05-11 — Pivot v3 (refinement)

- ✅ Drop edit cycle: agenty tylko CREATE, nigdy UPDATE (ADR-014).
- ✅ Drop selection bridge: out-of-scope MVP (ADR-011 superseded).
- ✅ Drop variant linking: powiązane noty = thread folder (ADR-010 superseded by ADR-014).
- ✅ Add lifespan model: 30 dni default, `is_final` marker = indefinite (ADR-015).
- ✅ Confirm FTS5 + text extraction strategy; bez markdown shadow (ADR-016).
- ✅ Add analytics tabela `events` od S1 — pomiar 50% token claim z ADR-012 (ADR-017).
- ✅ Add OG screenshot pipeline per publish (ADR-018).
- ✅ Sprint plan v3: 7 sprintów (zamiast 8 w v2), MVP = S1+S2+S3+S4.



---

## 2026-05-11 — Refinement v3.1

- ✅ `folio.suggest_thread` mandatory przed `folio.create` (opcja B z 3 zaproponowanych).
- ✅ No loose notes — każda nota ma thread; brak fallbacku do daily bucket.
- ✅ Implicit final on publish — `folio.publish` auto-ustawia `is_final=true`.
- ✅ ADR-019 dodane: `folio.list_expiring` MCP tool + gated proactive surfacing w Skill (anty-Clippy reguły).



---

## 2026-05-11 — Refinement v3.2 (Theme system)

- ✅ ADR-020: hybrid theme system (CSS + prompt addendum). User-instynkt potwierdzony, ale mocniejsze niż sam prompt.
- ✅ 8 starter themes: folio, newsroom, notebook, brutalist, linen, terminal, pastel, dossier.
- ✅ Theme = folder z `theme.css` + `theme.md`. User-extensible (drop folder, gotowe).
- ✅ Mockup `mockup-themes.html` w repo — wizualna spec + prompt addendum dla każdego.
- ✅ Sprint updates: S2 (bundle themes), S3 (MCP theme param + list_themes), S4 (Skill addendum injection), S7 (theme switcher w viewerze).


---

## 2026-05-11 — Default theme = Linen

**Decyzja:** Domyślny theme dla świeżych instalacji = **Linen** (ADR-020 update).

**Uzasadnienie:** Najmniej kontrowersyjny dla niedevs. Apple polish jako pierwsze wrażenie. Dev-targeted users zmienią na Folio default; reszta zostanie na Linen.

**Implementacja:** `folio init` ustawia `theme: "linen"` w `folio.config.json`.



---

## 2026-05-11 — S0+S1+S2 implementation (first commit)

Greenfield → working CLI + viewer w jednej sesji.

**Stack zainstalowany:**
- Bun 1.3.13 (Homebrew via oven-sh/bun tap)
- `@modelcontextprotocol/sdk` 1.29.0 — ✓ smoke test passes na Bun (ADR-001 walidacja)
- Eta 4.6, sanitize-html 2.17, ulid 3.0

**Co działa:**
- `folio init` — bootstraps `~/Folio/` (configurable via `FOLIO_HOME`)
- `folio new --title X --type research --thread Y --tags a,b --html @file` — pełny create flow
- `folio list [--type] [--thread] [--final] [--json]`
- `folio search "query"` — FTS5 BM25 z field weighting (title ×5, headings ×3, body ×1, tags ×4), tokenizer PL (`unicode61 remove_diacritics 2`) — szuka „swieze" znajduje „świeże"
- `folio finalize <id>` — mark final, clears expires_at
- `folio stats` — counts + analytics (class_match_rate, total_events)
- `folio serve` — Bun HTTP server na 4810 z viewerem (browse, search results, thread view, single note z sidebarem + iframe, /api/list, /api/search, /api/stats, /themes/:name/theme.css route, /health)

**Storage (S1):**
- SQLite (FTS5) z 4 tabelami: notes, tags, notes_fts, events
- HTML extraction przez Bun HTMLRewriter (title, headings, body separately)
- Atomic write (.tmp + rename)
- ULID per note, kebab-case slug z PL translit, unique-in-folder
- Append-only (ADR-014): brak update/delete API; user-only delete (post-S5)

**Themes (S2):**
- Bundled: linen (default), folio. Każdy = `theme.css` + `theme.md` (prompt addendum).
- Theme resolution: `~/Folio/themes/<name>` user-extensible, fallback do bundled.
- Render profile: hosted (default) — `<link>` do `/themes/:name/theme.css` przez viewer; standalone — inline CSS dla share/publish.

**Templates (S2):**
- `_base.html.eta` — wrapper z metadata `<meta name="folio:*">`, conditional inline/link, `<script id="folio-metadata">` JSON.
- `research.html.eta` — typed template z slot'ami (tldr, sections, sources, open_questions).
- Eta z `renderString` (custom resolver: user templates → bundled fallback).

**Sanitize (ADR-007):**
- sanitize-html allowlist, scoped do body fragmentu (bez `<html>/<head>/<body>/<style>/<title>/<meta>` — należą do template).
- Track sanitizer_drops do analytics.

**Analytics (ADR-017):**
- Tabela `events` z `note_created` (token count, class_count, inline_style_count, sanitizer_drops, body_size_kb), `note_viewed`, `note_finalized`, `search_query`.
- `folio stats` pokazuje class_match_rate (% klas vs inline style).

**Tests (`bun test`):**
- 4/4 pass: init+create+search round-trip, slug uniqueness, finalize clears expires_at, analytics tracks class usage.

**Project tree:**
- `bin/folio.ts` — CLI entry
- `src/cli/{index,io}.ts` + `src/cli/commands/{init,new,list,search,finalize,stats,serve}.ts`
- `src/core/{config,db,storage,sanitize,text,slug,themes,templates,types}.ts`
- `src/viewer/{server,render}.ts`
- `templates/_base.html.eta`, `templates/research.html.eta`
- `themes/linen/{theme.css,theme.md}`, `themes/folio/{theme.css,theme.md}`
- `tests/storage.test.ts`
- `docs/*.html` — wizualne mockupy (plan-dzialania, plan-implementacji, mockup-viewer, mockup-themes)

**Co dalej:**
- S3: MCP server (folio-mcp binary, tools: create/get/list/search/finalize/suggest_thread/list_expiring/list_themes)
- S4: OpenClaw Skill + STYLEBOOK + flow examples + thread heuristic
- S5: Lifespan daemon (auto-cleanup po 30d non-final)
- Niewykonane sprinty: S6 (cloud), S7 (polish, mobile, OS release)
- Polish bugs: BM25 score display (negatywne, malutkie liczby) → użyć rank zamiast raw
- Brak komendy `folio open <id>` (otwierałaby /n/:id w defaultowej przeglądarce)
- Templates: dodać `comparison` i `technical` przed S4

**Repo state:** `~/Projects/Folio` — pliki Folio CLI + viewer + 4 HTML mockupy w `docs/`. Bez `git init` (decyzja usera kiedy).



---

## 2026-05-11 — S3+S4+S5 implementation (full MVP)

Pełny pipeline communication: agent → MCP create → file on disk → viewer URL → user reads → optional finalize. Tylko cloud publish (S6) i polish (S7) zostały.

**S3 — MCP server (commit 6f76956):**
- `bin/folio-mcp.ts` (stdio) + `src/mcp/server.ts`
- 8 tools: `folio.create`, `folio.get`, `folio.list`, `folio.search`, `folio.finalize`, `folio.suggest_thread`, `folio.list_expiring`, `folio.list_themes`
- Each tool z agent-facing description + JSON Schema inputSchema (no Zod, custom validation)
- `folio.create` zwraca `response_hint` z konwencją `MEDIA:URL` + TL;DR
- `folio.get` ekstraktuje sam `<article>` body (tańszy niż pełny doc)
- `folio.suggest_thread` proponuje slug gdy brak match (anti-duplication)
- `folio.list_themes` zwraca pełny `prompt_addendum` z theme.md dla Skill injection
- `docs/mcp-setup.md` — Claude Desktop / OpenClaw / Cursor manifesty
- `folio open <id|slug>` — CLI wrapper na macOS `open` (xdg-open/start cross-platform)
- Templates: `comparison.html.eta`, `technical.html.eta` z typed slots

**Storage fix wykryty w S3:**
- escapeFtsQuery dzieli na hyphenie też (unicode61 tokenizuje "Fine-Tuning" jako 2 tokeny)
- suggestThread używa column-scoped FTS5 match (`title:foo*`) + simple ORDER BY MAX(created) (bm25 nie działa pod agregacją z column filters)

**S4 — Skill + STYLEBOOK + examples (commit 52d347e):**
- `skills/folio/SKILL.md` z frontmatter — triggers, mandatory `folio.suggest_thread` pre-create, type+theme selection tables, MEDIA response convention, anti-Clippy gating (ADR-019)
- `skills/folio/STYLEBOOK.md` — utility class contract (.eyebrow, .lead, .pill, .card, .cards, .verdict), do/don't, per-theme voice cheatsheet
- `skills/folio/examples/{research,comparison,technical,snippet}/` — 4 typed few-shot examples (prompt.md + output.html)

**S5 — Lifespan / cleanup:**
- `storage.ts cleanup()` — 2-faza: (1) non-final past expires_at → `.trash/<id>/`, (2) trash > grace days → hard delete (FS + DB + FTS)
- `folio cleanup [--dry-run] [--grace-days N] [--json]`
- Brak daemonu cron-style w MVP (uruchamia się przez CLI; viewer może na startup, gdy potrzebne)

**Testy: 23/23 pass:**
- storage 4 (create+search+slug+analytics+finalize)
- mcp 9 (tools/list + 8 tool calls)
- skill-examples 6 (każdy example renderuje się przez sanitize+create z inline_style_count=0)
- cleanup 3 (dry-run, phase 1 trash, phase 2 hard delete)

**Stan po sesji:**
- ✅ S0 — Pivot decisions + repo init + MCP SDK validated na Bun
- ✅ S1 — Storage (SQLite + FTS5) + viewer + analytics
- ✅ S2 — Templates (research, comparison, technical) + themes (Linen default + Folio) + render profiles
- ✅ S3 — MCP server (8 tools)
- ✅ S4 — Skill (triggers, stylebook, 4 examples)
- ✅ S5 — Lifespan cleanup
- ⬜ S6 — Cloud publish (folio.app — osobne repo, nie blokuje)
- ⬜ S7 — Polish + mobile + OS release

**Commits:**
- 4d57049 Initial: Folio MVP (S0+S1+S2)
- 6f76956 S3: MCP server + folio open + extra templates
- 52d347e S4 (Skill) + S5 (cleanup): full pipeline complete

**Co dalej (rekomendacje):**
1. **Wpiąć folio-mcp do Claude Desktop** (zobacz `docs/mcp-setup.md`) i przetestować real flow z Ryszardem.
2. **Pomierzyć class_match_rate** po kilku realnych użyciach — walidacja ADR-012 (50% token saving claim).
3. **S6 cloud** — osobny projekt `folio-cloud`. Zacząć od minimalnego: GitHub OAuth + public unlisted URL + OG screenshot via Playwright on edge.
4. **Polish:** BM25 score display w CLI search (małe negatywne liczby), `folio open` na Linux/Windows testing, `folio reindex` dla recovery po lost SQLite.



---

## 2026-05-11 — Implementation sprint (S0→S5) + brand + first real usage

Wszystko od ostatniego wpisu (Linen default) do teraz. **Folio jest live i used.**

### Commits w `~/Projects/Folio` (git log oneline)

```
8623775  Polish: OpenClaw-first docs, PL stemmer, folio export
1d545bf  viewer: compact list rows + /threads + thread search
9aa62f2  Themes: ship 6 remaining + widen wraps
bff369c  Fix: PL ł/Ł symmetry in FTS search (Ryszard's Bug 2)
6d014f5  Brand: apply v08 wordmark + rebrand Linen & Folio themes
52d347e  S4 (Skill) + S5 (cleanup): full pipeline complete
6f76956  S3: MCP server + folio open + extra templates
4d57049  Initial: Folio MVP (S0+S1+S2)
```

### Sprinty zamknięte

- ✅ **S0** — Pivot decisions + Bun 1.3.13 + MCP SDK validated na Bun
- ✅ **S1** — Storage (SQLite + FTS5 BM25 + PL tokenizer) + viewer + analytics
- ✅ **S2** — 8 themes (linen default, folio noir, newsroom, notebook, brutalist, terminal, pastel, dossier) + 3 templates (research, comparison, technical) + dwa profile renderu (hosted/standalone)
- ✅ **S3** — MCP server: 8 tools (create, get, list, search, finalize, suggest_thread, list_expiring, list_themes)
- ✅ **S4** — OpenClaw Skill + STYLEBOOK + 4 typed examples (research/comparison/technical/snippet)
- ✅ **S5** — Lifespan + auto-cleanup (2-phase: trash 30d, hard-delete +7d)

### Brand zaaplikowany

Wordmark v08 z `~/.openclaw/workspace/folio-wordmarks-v5.html`:
- **Top bar viewera:** `folio.` (Familjen Grotesk 500 + orange dot) | divider | `VISUAL COMM FOR AGENTS` (JetBrains Mono caps)
- Tagline pivot-aligned (v08 mock miał „YOUR SECOND BRAIN" sprzeczne z naszym pivotem — zmieniłem; user może dalej zmienić jedną linijką)
- Linen rebrand: warm cream `#f5f3ee` + orange `#ff5a1f` + Familjen Grotesk headings + Instrument Serif italic dla `.lead`
- Folio (noir) rebrand: dark `#0a0a0a` + ta sama DNA, dark mode

### Pierwsze realne użycie z Ryszardem (OpenClaw)

- Wpięty przez `mcporter config add folio --command bun --arg .../folio-mcp.ts --scope home`
- Skill via symlink: `~/.openclaw/workspace/skills/folio` → `~/Projects/Folio/skills/folio`
- Ryszard wygenerował 4 wątki (~13 not): `postgres-vs-sqlite-for-small-saas` (2 noty, 1 final), `folio-mcp-test-report-snippet`, `tesla-modele-2026-przeglad-polska`, `theme-gallery-demo` (8 demo not, każda w innym themie)

### Bug reports z Ryszarda → fixes

**Bug 2 (PL diakrytyki — fixed in bff369c):**
- Root cause: `ł` (U+0142) i `Ł` (U+0141) są niezależnymi codepointami Unicode, nie combining marks. FTS5 `remove_diacritics 2` obsługuje tylko combining → strips ą/ę/ć/ó/ś/ź/ż ale nie ł/Ł
- Fix: `plNormalize()` w warstwie aplikacji — symetryczna normalizacja na obu stronach FTS (insert + query)
- Nowa komenda `folio reindex` żeby przebudować FTS po zmianie normalizacji
- Weryfikacja: `q=małego` i `q=malego` → te same 2 noty

**Bug 1 (suggest_thread empty matches):**
- Cannot reproduce — wszystkie moje test queries matchują threads
- Likely fixed przez wcześniejszy commit 52d347e (escapeFtsQuery dzielący na hyphen)
- Odpowiedź pushed jako nota w threadzie `folio-mcp-test-report-snippet`, czekamy na exact query od Ryszarda

### UX feedback z użycia

User: „lista nieczytelna + nie ma wyszukiwania wątków" → commit 1d545bf:
- Stare cards (80-100px) → compact rows (~36px). 4-5× więcej not widocznych
- `/threads` osobna strona z listą wątków, count, latest, final-marker
- `/search?q=` zwraca teraz BOTH notatki AND wątki (w 2 sekcjach)
- Top bar nav: `noty | wątki | stats`
- Search obsługuje slug-match (LIKE) + FTS na tytułach w wątku
- API: `/api/threads[?q=]`

User: „sztuczne zwężenie layoutu" → commit 9aa62f2:
- Linen wrap-max 760 → 880
- Folio noir 880 → 960

### Polish round (8623775)

- **`docs/mcp-setup.md`** — przepisany OpenClaw-first (Claude Desktop spadł do „alternative")
- **PL stemmer** (`plStem` w `slug.ts`) — popularne końcówki PL stripowane przy query (3-letter -ego/-emu/-ach/-ami/-owi/-iej/-ich, 2-letter -em/-om/-ow/-ej, 1-letter -a/-e/-i/-o/-u/-y z thresholdami długości). Index zostaje pełny → snippet pokazuje real słowa. Query staje się krótsze → prefix-match łapie więcej fleksji. Live: `wyboru` / `wybór` / `wyborów` znajdują te same 10 not
- **`folio export <id> --standalone`** — re-render z inline CSS, 9KB self-contained HTML. **S6 cloud nie jest konieczny żeby share'ować** — exportujesz, wrzucasz w mail/Telegram, działa

### Testy

29/29 zielone:
- storage (5) — create+search+slug+analytics+finalize
- mcp (9) — wszystkie 8 tools + ListTools
- skill-examples (6) — każdy przykład renderuje przez sanitize+create z `inline_style_count=0`
- cleanup (3) — dry-run + phase 1 trash + phase 2 hard-delete
- stemmer (6) — base forms, case endings, 3 inflection tiers, plNormalize composition

### Stan w `~/Folio/` (live data)

- 13 not aktywnych (zreindeksowane po bug 2 fixie)
- 4 wątki, 1 final
- Theme distribution: 11× linen (default), 1× folio noir, 1× dossier (z theme gallery demo)
- analytics `events` table: ~30+ entries (note_created, note_viewed, note_finalized, search_query)

### Co dalej

**Out of scope na tę sesję:**
- ⬜ **S6 — Cloud publish** (folio.app, osobne repo, GitHub OAuth + magic link + OG screenshots)
- ⬜ **S7 — Polish: mobile responsive review + Claude Design redesign viewer'a + OS release**

**Backlog drobiazgów:**
- BM25 score display polish (negatywne mikroliczby w CLI search)
- Reindex po zmianie theme'u (theme.css zmiana wymaga rebuild dla standalone notatek już opublikowanych)
- Folio mockupy w `docs/` na starej (purple) brandzie — celowo, mogą być rerendered jak ktoś użyje
- Niezreprodukowany Bug 1 — czekamy na exact query od Ryszarda
- Multi-agent w tym samym threadzie (eventual consistency w append-only — działa, ale niesprawdzony pod loadem)

### Konkretne komendy które działają teraz

```bash
folio init
folio new --title T --type X --thread Y --html @file.html
folio list [--type] [--thread] [--final] [--json]
folio search "query"  # PL stemmer aware
folio finalize <id>
folio open <id|slug>
folio export <id> --standalone --out file.html
folio cleanup [--dry-run]
folio reindex
folio stats
folio serve  # → http://127.0.0.1:4810
folio-mcp     # stdio MCP server for agents
```

### Stan repo

```
~/Projects/Folio/
├── bin/folio.ts, folio-mcp.ts
├── docs/  (4 design mockups + mcp-setup.md)
├── skills/folio/ (SKILL.md, STYLEBOOK.md, 4 examples)
├── src/core/ (config, db, storage, sanitize, slug, text, themes, templates, types)
├── src/cli/commands/ (init, new, list, search, finalize, stats, cleanup, reindex, export, open, serve)
├── src/mcp/server.ts
├── src/viewer/ (server.ts, render.ts)
├── templates/ (_base, research, comparison, technical)
├── themes/ (linen DEFAULT, folio, newsroom, notebook, brutalist, terminal, pastel, dossier)
└── tests/ (29 tests, 5 files)
```
