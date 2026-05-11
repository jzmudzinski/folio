# 📋 Folio — TODO (v3 post-refinement)

> Aktywne sprinty. Co zrobione → [[Changelog]].
> **Pivot v3 (2026-05-11):** Append-only, thread folders, final marker, auto-cleanup, FTS od dnia 1. Bez edit / selection / variant-linking.

**Ostatnia aktualizacja:** 2026-05-11 (refinement po pivot v2)

---

## 🟡 Sprint 0 — Pivot decisions + repo init

- [x] Plan v1 + krytyka + Thariq validation + pivot v2 + refinement v3
- [x] Update Folio.md / Decisions.md / TODO.md / Changelog.md
- [ ] **Decyzja: nazwa finalna** + domain check (folio.app, folio.dev, getfolio.app)
- [ ] **Decyzja: subdomain layout** (path-based vs subdomain) — ADR-013
- [ ] **Decyzja: thread_id strategia** — agent wymyśla / folio suggeruje / hybrid?
- [ ] Repo init `~/Projects/Folio` + git + bun init
- [ ] Walidacja: `@modelcontextprotocol/sdk` na Bun (smoke test przed S3)

---

## ⬜ Sprint 1 — Storage + viewer + `folio.create` + FTS + analytics

Cel: pojedyncza komenda zapisuje notę, viewer pokazuje URL, FTS indeksuje, telemetria leci.

- [ ] Struktura repo: `src/`, `templates/`, `bin/`, `tests/`
- [ ] Storage:
  - [ ] Layout: `~/Folio/threads/<thread_id>/<id>.html` lub `~/Folio/notes/YYYY/MM/<id>.html` (bez threadu)
  - [ ] Atomic write: `.tmp` + rename
  - [ ] Tabela `notes`: id, slug, path, title, type, theme_profile, thread_id, is_final, created, updated, expires_at
- [ ] FTS5 (ADR-016):
  - [ ] HTML → plain text extraction (Bun HTMLRewriter; wyciągamy title, headings array, body)
  - [ ] Virtual table `notes_fts(id UNINDEXED, title, headings, body, tags)`
  - [ ] BM25 z column weights: title ×5, headings ×3, body ×1, tags ×4
  - [ ] Tokenizer: `unicode61 remove_diacritics 2 tokenchars=-` (lepsze dla PL niż porter EN)
  - [ ] Snippet generation z highlightem
- [ ] Tabela `events` (ADR-017):
  - [ ] Event types: `note_created`, `note_viewed`, `note_finalized`, `note_deleted`, `thread_continued`, `search_query`
  - [ ] Per `note_created`: body_size_kb, plain_text_size, class_count, inline_style_count, sanitizer_drops, theme_profile, thread_id, agent_name?
- [ ] Local viewer (`folio serve`, port 4810):
  - [ ] `GET /` lista chronologiczna
  - [ ] `GET /n/:id` render
  - [ ] `GET /t/:thread_id` lista not w threadzie (collection view)
  - [ ] `GET /search?q=...` search z snippet/highlight
  - [ ] SSE `/sse` hot reload na file watch
- [ ] CLI: `folio new --html @file.html [--thread X]`, `folio search "..."`, `folio stats`

**DoD:** zapisuję plik, `folio new` zwraca URL, `folio search "rag"` znajduje, `folio stats` pokazuje token count i class match rate.

---

## ⬜ Sprint 2 — Templates + theme + render profiles

Cel: theme spójny, dwa profile renderu działają.

- [ ] `theme.css` — variables, utility classes (ADR-012 stylebook reference)
- [ ] `_base.html.eta` — conditional: standalone (`<style>` inline) vs hosted (`<link>` + per-note overrides)
- [ ] Templates: `research`, `comparison`, `technical`
- [ ] HTML sanitizer (`sanitize-html`) przy zapisie
- [ ] CLI: `folio render <id> --profile standalone|hosted` — rebuild
- [ ] **Metryka:** zmierzone token count per typ × profile (walidacja 50% claim z ADR-012); zapisać benchmark do `STYLEBOOK.md`

**DoD:** ta sama nota działa w obu profilach, delta tokenów udokumentowana.

---

## ⬜ Sprint 3 — MCP server (create, get, list, search, finalize, suggest_thread)

Cel: agent w pełni używa MCP — w tym suggest_thread przed create.

- [ ] `bun add @modelcontextprotocol/sdk`
- [ ] Stdio transport `bin/folio-mcp`
- [ ] Tools z Zod schemami:
  - [ ] `folio.create({ type, title, body_html, theme_profile?, thread_id?, tags? })` → `{ id, local_url, thread_siblings? }`
  - [ ] `folio.get({ id })` → metadata + body
  - [ ] `folio.list({ type?, thread_id?, is_final?, since?, limit? })` → notes
  - [ ] `folio.search({ query, limit?, type? })` → FTS results z snippet + score
  - [ ] `folio.suggest_thread({ title, type })` → top-N matching threadów (FTS na title)
  - [ ] `folio.finalize({ id })` → mark is_final
- [ ] Brak `folio.update` / `folio.delete` (ADR-014). Tylko user może deletować z CLI.
- [ ] Smoke testy (`bun test`)
- [ ] Manifest dla Claude Desktop / OpenClaw

**DoD:** Claude Desktop: `folio.suggest_thread → folio.create → folio.search` end-to-end.

---

## ⬜ Sprint 4 — OpenClaw Skill + thread heuristics

Cel: Ryszard rozumie kiedy używać Folio, kiedy continuować thread, kiedy zaczynać nowy.

- [ ] `skills/folio/SKILL.md` — trigger heuristics, template mapping
- [ ] `STYLEBOOK.md` — kontrakt z `theme.css` + dozwolone klasy + przykłady „tak"/„nie"
- [ ] 5 przykładów `examples/<typ>/{prompt.md, output.html}` do few-shot
- [ ] **Thread heuristic:**
  - Sygnał „popraw / inna wersja / dopracuj" → ten sam thread_id
  - Nowy temat → nowy thread (slugified z title)
  - Niepewność → `folio.suggest_thread` żeby sprawdzić istniejące
- [ ] Konwencja odpowiedzi: MEDIA:<local_url> + 3-5 linijek TL;DR

**DoD:** „Ryszard, porównaj Postgres vs MySQL" → nowa nota, nowy thread; „inna wersja, krótsza" → nowa nota, ten sam thread.

---

## ⬜ Sprint 5 — Lifespan + auto-cleanup + final marker

Cel: stare nieoznaczone noty same się sprzątają (ADR-015).

- [ ] Schema: `is_final BOOLEAN`, `expires_at` (computed: `created + default_lifespan` jeśli !is_final)
- [ ] Cleanup daemon (cron-style albo lazy on viewer-start):
  - [ ] Faza 1: `is_final=0 AND now > expires_at` → move do `~/Folio/.trash/<id>/`
  - [ ] Faza 2: w trash > 7d → faktyczny delete
  - [ ] Log do tabeli `events`: `note_deleted` z reason
- [ ] CLI: `folio finalize <id>`, `folio unfinalize <id>`, `folio cleanup --dry-run`, `folio trash list`
- [ ] Viewer: button „Mark as final" w sidebarze + banner „Auto-delete in N days" gdy !is_final
- [ ] MCP: `folio.finalize({ id })` (user proxy przez agenta)
- [ ] Config: `default_lifespan: 30d` w `folio.config.json` (tunable)

**DoD:** nota stworzona 30+ dni temu z !is_final → w .trash; ta sama z is_final=1 → zostaje.

---

## ⬜ Sprint 6 — Cloud publish (folio.app) + OG screenshot

Cel: `folio.publish` → URL na cloud + rich preview (ADR-013, ADR-018). Osobne repo.

- [ ] Osobne repo `folio-cloud` — Cloudflare Pages albo Vercel
- [ ] Auth: GitHub OAuth + magic-link email
- [ ] DB: D1 / Postgres — tabela `publications` (id, user_id, slug, audience, html_blob_url, og_image_url, created, view_count)
- [ ] Storage: R2 / Vercel Blob dla HTML + OG PNG
- [ ] Routing: `folio.app/<user>/<slug>` (path-based decyzja)
- [ ] CLI: `folio cloud login`, `folio publish <id> [--audience emails]`
- [ ] MCP: `folio.publish({ id, audience? })` → `{ url, og_url }`
- [ ] **OG screenshot pipeline:**
  - [ ] Worker bierze published HTML → Playwright na edge → screenshot top 1200×630
  - [ ] Inject OG meta: `og:image`, `og:title`, `og:description` (1st paragraph)
  - [ ] W append-only modelu cache jest bezproblemowy (publikacje immutable)
- [ ] Audience modes: `public`, `unlisted`, `invited:[emails]`
- [ ] Build: `hosted` → `standalone` rebuild przy publish (ADR-012)

**Out of scope MVP cloud:** monetyzacja, custom domains, commenting, multi-region.

**DoD:** publish → wklejony URL w Telegram pokazuje rich preview ze screenshotem; magic-link działa na phone.

---

## ⬜ Sprint 7 — Polish, mobile, open source

- [ ] Responsive theme — wszystkie templates 320-768px
- [ ] Reader mode (focused, bez sidebaru)
- [ ] Dark/light auto z `prefers-color-scheme`
- [ ] Print/PDF eksport — `folio export --pdf` via Puppeteer
- [ ] Onboarding wizard `folio init` z 3 demo notami
- [ ] README + dokumentacja + landing page na folio.app
- [ ] Brand: logo, color, voice
- [ ] OS release decision (MIT/Apache, gdzie repo, contribution guide)

---

## 🧠 Backlog

- Multi-agent: conflict resolution gdy 2 agenty piszą do tego samego threadu (last-write-wins albo agent-segregated)
- Embeddings semantic search (opt-in, gdy FTS5 przestaje wystarczać; sqlite-vec extension; hybrid FTS+vec)
- Voice annotation w viewerze
- Slack/Discord bot: `/folio research X` → URL w czacie
- Folio jako library w innych projektach (TeachPaper paper summaries)
- ML-based thread suggest (post-FTS-only)
- Time-bound publish („pokazuj 7 dni, potem 404")
- Edycja inline / selection bridge — gdyby kiedyś okazała się potrzebna (v2 plan w archiwum)
- PL lemmatizer dla lepszego FTS (popularne końcówki: -ego, -emu, -ach, -ami)
- Cloud subscription model (gdy >X publish/miesiąc)

---

## 🚫 Wycięte z planu (były w v1/v2)

- ❌ Variants z `variant_of` field → niezależne noty w thread folder (ADR-014)
- ❌ Selection bridge (ADR-011 superseded) → no edit cycle
- ❌ Edit mode w MCP (`folio.update`) → tylko CREATE
- ❌ Side-by-side variants UX → user przegląda thread folder
- ❌ Backlinks / graph → KB feature, nie communication
- ❌ Markdown shadow files → niepotrzebne (ADR-016)
- ❌ `.versions/` jako linear history → brak (nie ma edycji)



---

## 🔁 Amendment v3.1 — task delta (2026-05-11 evening)

**S3 (MCP server):**
- [ ] **Dodaj** `folio.list_expiring({ within_days = 7, limit = 10 })` → `[{ id, title, thread_id, days_left, type }]`
- [ ] **Reguła:** `folio.create` z `thread_id` ≠ null wymagane (Skill enforce; MCP może warning'ować)
- [ ] **Drop** fallback do `notes/YYYY/MM/` — gdy agent nie poda thread_id, Folio sam slugify'uje z title

**S4 (OpenClaw Skill):**
- [ ] `folio.suggest_thread` w mandatory pre-create checklist
- [ ] **Surfacing heuristic** (ADR-019):
  - Trigger TYLKO w Folio-related convo (słowa: folio/notatka/research/publish, użyte folio.* w session)
  - Natural moment po `folio.publish`
  - Hard NO w niezwiązanych convo
  - Max 5 not w jednym surfaceu
  - Skip idem id w 24h
- [ ] Skill state cache: `~/.folio/skill_state.json` z `last_surfaced: { id: timestamp }`

**S5 (Lifespan):**
- [ ] **Dodaj:** `folio.publish` → automatyczny `is_final=true`
- [ ] CLI: `folio unfinalize <id>` do odznaczenia ad-hoc publish'a
- [ ] Cleanup daemon czyta `expires_at` (computed: `created + default_lifespan` jeśli !is_final, NULL jeśli is_final)



---

## 🔁 Amendment v3.2 — Theme system (2026-05-11)

Po ADR-020 (hybrid theme system) zmiany w sprintach:

**S2 (Templates):**
- [ ] Bundle 8 starter themes zamiast jednego `theme.css`:
  - `themes/folio/` (default, dark + purple)
  - `themes/newsroom/` (editorial, serif, red accent)
  - `themes/notebook/` (paper, handwritten headers, blue ink)
  - `themes/brutalist/` (white/black, bold, geometric)
  - `themes/linen/` (Apple minimal, off-white)
  - `themes/terminal/` (green-on-black, mono)
  - `themes/pastel/` (peach/sage soft, rounded)
  - `themes/dossier/` (manila + typewriter)
- [ ] Każdy theme = `theme.css` + `theme.md` (prompt addendum)
- [ ] Templates (research, comparison, technical) muszą działać w każdym theme bez ingerencji
- [ ] Pomiar: token count per theme × profile (ADR-012 walidacja)

**S3 (MCP):**
- [ ] Dodać `theme?: string` param do `folio.create`
- [ ] Nowy tool `folio.list_themes()` → `[{ name, summary, mood, best_for }]`
- [ ] User config: `folio config set theme <name>` jako default per user

**S4 (Skill):**
- [ ] Skill zna listę bundled themes + kiedy każdy proponować
- [ ] Pre-create heurystyka: "long-form research" → suggest Newsroom; "system design" → Terminal; "personal brainstorm" → Notebook
- [ ] Inject `theme.md` aktualnego theme'u do prompta przed generowaniem `body_html`
- [ ] Examples: po jednym per theme dla few-shot

**S7 (Polish):**
- [ ] Theme switcher w viewerze (dropdown w note view sidebar)
- [ ] Hosted profile: instant re-render z nowym theme'em
- [ ] Standalone: `folio render <id> --theme=<new>` rebuild

**Mockup:** `mockup-themes.html` w repo = wizualna spec + prompt addendum każdego theme'u.
