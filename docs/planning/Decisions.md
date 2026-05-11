# 🧭 Folio — Architectural Decisions

> ADR (Architecture Decision Records) — krótka, ludzka forma.

---

## ADR-001 — Bun zamiast Node

**Status:** Proposed (2026-05-11)

**Kontekst:** Potrzebujemy lekkiego runtime'u do CLI + MCP server + viewer.

**Decyzja:** Bun + TypeScript.

**Dlaczego:**
- Single binary, zero-config TS, native SQLite (`bun:sqlite`), wbudowany HTTP server.
- Szybki startup CLI (~10ms vs Node ~80ms).
- Bun test wystarczy — nie potrzeba Vitest.

**Tradeoffy:**
- Mniejsze community niż Node, ale rośnie szybko.
- Niektóre paczki npm jeszcze mają drobne incompatibility — sprawdzamy `@modelcontextprotocol/sdk` przed zaczęciem (jest TS, więc OK).

**Alternatywy odrzucone:**
- Node: wolniejszy start, więcej setupu.
- Deno: świetny, ale npm interop nadal kuleje przy MCP SDK.
- Rust: overkill na MVP; możemy przepisać hot-paths gdy będą.

---

## ADR-002 — SQLite z FTS5 zamiast JSON

**Status:** Proposed

**Kontekst:** Potrzebujemy metadata store + full-text search nad notatkami.

**Decyzja:** SQLite + FTS5 dla search.

**Dlaczego:**
- FTS5 = pełnotekstowy search bez dodatkowych zależności (Elastic, Meilisearch, etc.).
- Schema-y i indexy w jednym pliku, łatwe do backupu.
- Bun ma natywny `bun:sqlite`, bez WASM, szybkie.

**Tradeoffy:**
- Niezbyt dobry concurrent write — ale Folio z założenia single-user.
- Re-indeks przy bulk import może być powolny — akceptowalne.

**Alternatywy odrzucone:**
- JSON file: nie ma search, każda mutacja = przepisz wszystko.
- LMDB / DuckDB: za grube/za mało zbadane dla naszego usecase'u.

---

## ADR-003 — HTML zamiast Markdown jako format primary

**Status:** Proposed

**Kontekst:** Folio ma być **AI-native** i **estetyczne**. Markdown wymaga renderera, którego stylowanie zależy od narzędzia.

**Decyzja:** Notatki są **standalone HTML files** ze wszystkim inline (style, metadata, content).

**Dlaczego:**
- Każda notatka działa wszędzie — otwórz w przeglądarce, wyślij na Telegram, GitHub Gist.
- LLM świetnie generuje HTML; theme.css jest spójny → spójne notatki.
- Metadata żyje w samym pliku (`<meta name="folio:...">`) → jeśli baza zginie, odtwarzamy z plików.

**Tradeoffy:**
- Ręczna edycja HTML jest mniej przyjemna niż md. Mitigation: edycja przez agenta + viewer z trybem edit.
- HTML jest verbose'ny → większe pliki. Akceptowalne dla notatek (10–100KB).
- Renderowanie do PDF / md fallback → osobna ścieżka.

**Alternatywy odrzucone:**
- Markdown + custom renderer: lock-in narzędzia, ten sam problem co Obsidian.
- AST-based format (Notion-like): brak portability.

---

## ADR-004 — MCP server **i** OpenClaw Skill (oba)

**Status:** Proposed

**Kontekst:** Jak agent ma odnaleźć/wyszukać/utworzyć notatki?

**Decyzja:** Zbudujemy **MCP server** (uniwersalny, dla każdego klienta MCP) **plus** **OpenClaw Skill** który nakieruje konkretnie Ryszarda.

**Dlaczego oba:**
- MCP = standard. Działa z Claude Desktop, Cursor, OpenCode, każdym agentem co umie MCP. Re-używalny.
- Skill = layer ponad MCP. Mówi *kiedy* używać tool'i, jakie template'y wybrać, jak ma wyglądać body_html (styleguide), jak Ryszard ma się komunikować z Jarkiem o nowych notatkach.

**Bez Skilla MCP daje tooling. Bez MCP Skill nie ma czego używać. Razem = full UX.**

**Tradeoffy:**
- Podwójna powierzchnia do utrzymania. Mitigation: Skill jest cienki (instrukcje + przykłady), nie ma w nim logiki.

**Alternatywy odrzucone:**
- Tylko CLI + exec: działa, ale brak structured tool calls = większe ryzyko błędów agenta.
- Tylko MCP: agent nie wie jak ma używać — kiedy comparison, kiedy snippet, jak stylować.

---

## ADR-005 — Eta zamiast Handlebars / własnego silnika

**Status:** Proposed

**Kontekst:** Template engine dla bazowych typów notatek.

**Decyzja:** Eta (https://eta.js.org/).

**Dlaczego:**
- ~6KB, async-friendly, składnia EJS-like, sprawdzony.
- Wystarczy do naszego usecase'u (slot + helpers).

**Alternatywy odrzucone:**
- Handlebars: większy, mniej elastyczny dla async helperów.
- Template literals + funkcje: szybciej na początku, ale gorzej skaluje gdy templates urosną.
- React + SSR: overkill, bez build step Bun + JSX kuleje.

---

## ADR-006 — Folio NIE jest podpięte do Obsidian Vault (default)

**Status:** Open (do decyzji Jarka)

**Kontekst:** Czy `~/Folio/` ma być w środku Obsidian Vault, czy osobno?

**Opcje:**
1. **Osobno** (`~/Folio/`) — domyślnie. Pełna autonomia. Można sym-linkować jeśli ktoś chce.
2. **Wewnątrz Vault** (`~/Documents/Obsidian Vault/Folio/`) — pliki HTML są w Obsidianie, ale Obsidian nie umie ich przeszukiwać (FTS po md only) i renderuje brzydko.
3. **Hybryda** — Folio storage + auto-generowany shadow `.md` w Vault dla wyszukiwania.

**Lean:** opcja 1 (osobno) — Folio jest własnym narzędziem, Obsidian zostaje dla manualnych notatek.

---

## ADR-007 — HTML sanitization przed zapisem

**Status:** Proposed

**Kontekst:** LLM generuje body_html. Co jeśli wrzuci `<script>` lub złośliwy link?

**Decyzja:** Każda zapisana notatka przechodzi przez sanitizer (sanitize-html w Bun).

**Allowlist:**
- Tagi: `h1-h6, p, ul, ol, li, blockquote, pre, code, em, strong, a, img, table, thead, tbody, tr, th, td, hr, br, div, span, figure, figcaption, details, summary`
- Atrybuty: `class, id, href, src, alt, title, colspan, rowspan, data-folio-*`
- `style` attribute: **TAK** w `<div>/<span>` (potrzebne dla template'ów) — ale CSP w viewerze blokuje JS.

**Tradeoffy:**
- Tracimy egzotyczne tagi (np. `<canvas>`, `<svg>` interactive). SVG static — TAK, w allowlist osobno.
- Inline `<style>` w `<head>` przechodzi (theme), ale `<script>` NIGDY.

---

## ADR-008 — Wersjonowanie notatek

**Status:** Proposed

**Kontekst:** Edit-by-LLM może popsuć notatkę. Jak cofnąć?

**Decyzja:** Każda edycja zapisuje snapshot do `notes/.versions/<id>/<ISO-timestamp>.html`. Limit ostatnich 20 wersji (auto-prune).

**Alternatywa odrzucona:** git repo w `~/Folio/` — overhead i mieszanie modeli. Może opcjonalnie później.

---

## Otwarte do dyskusji

- ADR-009: Embeddings store — własna tabela w SQLite (vec-extension)? Czy chromaDB? Czy in-process?
- ADR-010: Multi-user / sync — do osobnego sprintu, nie blokujemy MVP.
- ADR-011: Plugin API — czy dopuszczamy custom templates from third parties? Jak load? Sandboxing?



---

## ADR-009 — Folio to medium komunikacji, nie storage (pivot)

**Status:** Accepted (2026-05-11)

**Kontekst:** Po artykule Thariqa „HTML is the new markdown" (2026-05-08) i krytyce v1 uświadomiliśmy, że Folio v1 ma niewłaściwe centrum. Long-term KB to *secondary*, nie cel. Główny ból: brak medium dla bogatej wizualnie *bieżącej* komunikacji agent→człowiek (i z powrotem). Markdown jest flat. Artifacts są Claude-locked. Loom to wideo.

**Decyzja:** Folio repozycjonowane jako „komunikacyjna warstwa wizualna agent↔człowiek". KB-features (FTS, backlinks, graph, semantic search, dedup) idą do backloga.

**Implikacje:**
- FTS5 znika z S1. Keyword LIKE wystarczy do ~1k notatek.
- Backlinks/graph wycofane z MVP.
- Persistent retention = side effect, nie wymóg.
- Dodajemy: selection bridge, variants, cloud publish.

**Tradeoffy:**
- Tracimy część claims „drugi mózg".
- Zyskujemy konkretny problem do rozwiązania z social proof (Thariq, Anthropic).

---

## ADR-010 — Variants over history

**Status:** Proposed

**Kontekst:** Edit cycle = agent generuje → user wskazuje fragment → agent dopracowuje. Diffy HTML są noisy (Kurtis Redux). User wciąż potrzebuje wrócić do wcześniejszej koncepcji.

**Decyzja:** Każda edycja przez agenta tworzy **wariant** (sibling, nie wersja). Viewer pokazuje side-by-side. User wybiera canonical → rodzeństwo zostaje, ale nieaktywne.

**Model:**
```sql
ALTER TABLE notes ADD COLUMN variant_of TEXT REFERENCES notes(id);
ALTER TABLE notes ADD COLUMN canonical INTEGER NOT NULL DEFAULT 1;
ALTER TABLE notes ADD COLUMN variant_idx INTEGER NOT NULL DEFAULT 1;
```

**Tradeoffy:**
- Dysk rośnie wolniej niż 20-snapshot history (zwykle 2-3 wariants per nota).
- Brak revert / diff — zamiast tego „wybierz właściwy".
- Variants są first-class, widoczne w viewerze; nie ukryty `.versions/`.

**Odrzucone:**
- Git auto-commits — działają, ale UX „pokaż obok siebie" jest gorszy.
- Snapshot do `.versions/` z `pruning` — wprowadza diff-mentality, której nie chcemy.

---

## ADR-011 — Selection-based interaction (viewer→agent bridge)

**Status:** Proposed

**Kontekst:** Ręczna edycja HTML to non-goal (HTML źle się edytuje, agent pisze szybciej). User komunikuje się z agentem wskazując — w viewerze zaznacza fragment, w czacie pisze „popraw to".

**Decyzja:**
1. Render: każdy block-level element w `<article>` dostaje `data-folio-selectable="s-<short>"`.
2. Viewer JS: listener na `selectionchange` mapuje DOM range → array selectable IDs + cytat tekstu.
3. Local bridge service (WebSocket 127.0.0.1:4811) trzyma current selection per note.
4. MCP server odczytuje przez `folio.get_selection({ note_id })` → `{ selection_ids[], text, html_fragment }`.
5. Agent woła `folio.update({ id, mode: "replace_selection", selection_ids, body_html })`.

**Tradeoffy:**
- Wymaga `folio serve` chodzącego (jeśli nie chodzi → fallback: agent prosi usera o wklejenie fragmentu).
- Selection state lokalny, single-user. Multi-tenant cloud = inny problem.
- Mobile selection (long-press) wymaga osobnej obsługi w S8.

**Odrzucone:**
- Browser extension — install friction, breaks bez ext.
- Native app (Tauri) — overkill na MVP.

---

## ADR-012 — Dwa profile renderu (standalone vs hosted)

**Status:** Proposed

**Kontekst:** HTML jest 2-4× droższy tokenowo niż markdown (Kurtis Redux). User dał target: **50% oszczędności tokenów na MCP layer**, nie 10%. Konflikt: standalone HTML (do share .html) wymaga inline'owania theme; hosted może odwoływać się do `/theme.css`.

**Decyzja:** Każda nota ma `theme_profile`:
- **`hosted`** (default): minimal markup, `<link rel="stylesheet" href="/theme.css">`, tylko per-note overrides w `<style>`. Działa pod `folio serve` lub `folio.app`.
- **`standalone`**: pełen theme + template CSS inline w `<style>`. Self-contained `.html`. Generowany przy `folio.publish` (gdy audience dostaje plik) lub `folio export --standalone`.

**Token math (rough):**
- Standalone: ~30KB output (15KB CSS + 15KB markup) → agent musi wygenerować/zaplanować całość.
- Hosted: ~5KB markup + 200B overrides → agent generuje tylko semantykę.
- **Realna oszczędność: 50-70%** dla typowej research-noty.

**Mechanizm:**
- Stylebook (kontrakt klas) jest *referencyjny* — agent zna klasy z theme.css, nie powiela CSS.
- Render time: `hosted` serwer doleci `<link>`; `standalone` build inline'uje przy export/publish.

**Tradeoffy:**
- Dwie ścieżki renderu = więcej kodu testowego.
- User otwierający „goły" plik HTML z `hosted` bez serwera zobaczy unstyled — UX risk. Rozwiązanie: domyślnie publikujemy zawsze `standalone`, lokalnie hostujemy.

---

## ADR-013 — Cloud publish (folio.app) to osobny projekt

**Status:** Proposed

**Kontekst:** `folio.publish` to user-facing feature. Infrastruktura cloud (subdomeny, auth, multi-tenant, billing) to osobne ryzyko techniczne i biznesowe.

**Decyzja:**
1. Folio CLI/MCP/local viewer NIE jest blokowane przez cloud.
2. `folio.app` = osobne repo (`folio-cloud`), deploy Cloudflare Pages albo Vercel.
3. CLI: `folio cloud login` (OAuth) + `folio publish <id> [--audience emails]`.
4. Format on cloud = `standalone` HTML (ADR-012) + metadata (audience, view count, expiry).

**Stack cloud (proposal):**
- Hosting: Cloudflare Pages albo Vercel (edge functions dla auth).
- Auth: GitHub OAuth (deweloperzy) + magic-link email (niedevs).
- DB: D1 / Postgres — pojedyncza tabela `publications` (id, user_id, slug, audience, html_blob_url, created, view_count).
- Asset storage: R2 / Vercel Blob.
- Routing: `folio.app/<user>/<slug>` (path-based) — łatwiejsze niż wildcard subdomain certs.

**Audience model:**
- `public` — anyone with link.
- `unlisted` — anyone with link, no search engines (noindex).
- `invited` — list emaili, magic-link auth, expiry.

**Tradeoffy:**
- Multi-tenant + emaile = GDPR/privacy compliance.
- Pricing model nieustalony (free do X publikacji + paid?).
- Custom domains, commenting, analytics → out-of-scope MVP.

**To S7+, nie blocker MVP komunikacji lokalnej.**



---

## 🔁 Pivot v3 refinements (2026-05-11 evening)

Po szczegółowym omówieniu zakresu pivotu, agreement:

- **Brak edycji.** Agenty tworzą nowe dokumenty, nigdy nie edytują.
- **Brak selection bridge.** Selekcja kursorem jako trigger edycji → out-of-scope, wraca gdy realnie potrzebne.
- **Brak variant linking.** Powiązane noty żyją w jednym thread folder, user przegląda.
- **Lifespan default.** Stare nieoznaczone noty soft-delete po 30 dniach.
- **Analytics od S1** — pomiar token count, class match rate, lifecycle.
- **OG screenshot** — każdy publish dostaje rich preview image.
- **FTS5 + text extraction** wystarczy. Bez markdown shadow.

**Status istniejących ADR:**
- **ADR-010 (Variants over history)** → ⚠️ SUPERSEDED by ADR-014. Brak variant linking model.
- **ADR-011 (Selection bridge)** → ⚠️ SUPERSEDED. Out-of-scope MVP.

---

## ADR-014 — Append-only model + thread folders

**Status:** Accepted (2026-05-11 refinement)

**Kontekst:** Komunikacja agent→człowiek nie wymaga edit-cyklu. User mówi „inna wersja, krótsza" → agent generuje *nowy* dokument. Tańsze, prostsze: brak state conflict, brak optimistic locking, brak selection.

**Decyzja:**
1. Agenty wywołują wyłącznie `folio.create`. Brak `folio.update`.
2. Iteracje tego samego tematu lądują w *thread folder*: `~/Folio/threads/<thread_id>/<note_id>.html`.
3. `thread_id` to slug (kebab-case) podawany przez agenta w `folio.create`.
4. Bez `thread_id` → fallback do daily bucket `~/Folio/notes/YYYY/MM/<id>.html`.
5. `folio.suggest_thread({ title, type })` zwraca top-N matching threadów (FTS na tytułach) — agent może continuować istniejący zamiast tworzyć nowy.
6. Viewer pokazuje thread folder jako collection view (`/t/:thread_id`).

**Tradeoffy:**
- Storage rośnie szybciej, ale auto-cleanup (ADR-015) trzyma w ryzach.
- Brak undo / revert — bo nigdy nic nie zostało zmienione, są tylko nowsze i starsze noty.
- Brak trace zmian per-sekcja — jeśli kiedyś potrzebne, wraca selection bridge.

**Odrzucone:**
- `variant_of` linking między notami → zbyt model-heavy; folder + thread_id wystarczy.
- Conversation_id matching z MCP → MCP nie eksponuje conversation_id w standardzie.

---

## ADR-015 — Lifespan + auto-cleanup

**Status:** Accepted (2026-05-11 refinement)

**Kontekst:** Bez auto-cleanup w 12 miesięcy `~/Folio/` = 5000+ not, większość z thread-iteracji. Dużo „v1 → v2 → v3 (final)" gdzie v1 i v2 to slop.

**Decyzja:**
- Default lifespan: **30 dni** dla `is_final = false`.
- `is_final = true` → indefinite.
- User markuje final przez:
  - Button w viewerze („Mark as final")
  - CLI: `folio finalize <id>`
  - MCP: `folio.finalize({ id })` — agent może na prośbę usera
- Cleanup daemon (cron albo lazy on viewer-start):
  - Faza 1: `!is_final AND age > 30d` → move do `.trash/<id>/`
  - Faza 2: w trash > 7d → faktyczny delete
- Config: `default_lifespan` tunable w `folio.config.json`.

**Edge cases:**
- Opublikowane (cloud) ale lokalnie non-final + age > 30d → cloud zostaje, lokalnie się czyści. Local i cloud są niezależne po publish.
- Thread bez żadnej final noty → cały thread może zniknąć (folder removed).

**Tradeoffy:**
- User musi pamiętać o markowaniu finalu. Mitigation: viewer banner „Auto-delete in N days unless finalized".
- Notyfikacja po czyszczeniu („wyczyszczono X not — pokaż listę") dla peace-of-mind.

**Odrzucone:**
- Indefinite retention → eksploduje dysk i FTS search noise.
- Auto-tag „important" przez ML → too magic dla MVP.

---

## ADR-016 — FTS5 + plain text extraction (no markdown shadow)

**Status:** Accepted (2026-05-11 refinement)

**Kontekst:** User pytał: smart FTS czy markdown shadow? Markdown shadow = double generation, lossy konwersja (scorecards, color, layout znikają), wzrost storage i token cost.

**Decyzja:**
1. Plain text extraction z HTML przy zapisie (Bun HTMLRewriter — wyciągamy title, headings, body separately).
2. SQLite FTS5 virtual table: `notes_fts(id UNINDEXED, title, headings, body, tags)`.
3. BM25 z column weights: title ×5, headings ×3, tags ×4, body ×1.
4. Tokenizer: `unicode61 remove_diacritics 2 tokenchars=-` — lepsze dla PL niż `porter` (porter to English stemming).
5. FTS5 built-in snippet + highlight dla viewer search UI.
6. **Brak markdown shadow files.** Jedno źródło prawdy = HTML.

**Scale:**
- 500 not = ~5MB FTS index. Trivial.
- 5000 not = ~50MB. Wciąż trivial.
- 50k not → partitioning per rok albo embedding (post-MVP).

**Tradeoffy:**
- PL stemming nie idealny (FTS5 brak natywnego lematyzera PL — „informacja" ≠ „informacje" jako tokeny). Mitigation: prosty heurystyczny stemmer popularnych końcówek PL (post-MVP).
- Snippet to plain text, nie HTML-aware — UX OK, nie pokazuje sekcji z originalnym layoutowi.

**Odrzucone:**
- Markdown shadow → double work, lossy, marnotrawi tokeny przy generation.
- Embedding semantic search od dnia 1 → premature optimization.
- External search (Elastic, Meilisearch) → infra overhead dla single-user.

**Roadmap embedding (post-S7, jeśli FTS przestaje wystarczać):**
- `folio embed-all` — opt-in, wektory dla wszystkich not (lokalny `gte-small` przez `transformers.js`, albo Anthropic API).
- `sqlite-vec` extension dla storage.
- Hybrid search: FTS5 BM25 + cosine similarity, reciprocal rank fusion.

---

## ADR-017 — Analytics od dnia 1

**Status:** Accepted (2026-05-11 refinement)

**Kontekst:** Token-saving claim z ADR-012 (50% przez hosted profile) wymaga *pomiaru*, inaczej vibes. Plus inne metryki ważne dla iteracji (jak długo user trzyma noty, ile threadów per prompt).

**Decyzja:** Tabela `events` w SQLite. Event types:
- `note_created` → `{ id, type, theme_profile, body_size_kb, plain_text_size, class_count, inline_style_count, sanitizer_drops, agent_name?, thread_id? }`
- `note_viewed` → `{ id, source: "viewer" | "share" | "cli" }`
- `note_finalized` → `{ id, age_days_at_finalize }`
- `note_deleted` → `{ id, reason: "auto" | "manual", age_days }`
- `thread_continued` → `{ thread_id, new_note_id, siblings_count }`
- `search_query` → `{ query_len, results_count, top_score }`

`folio stats` aggregaty:
- Total notes / by type / by thread / by agent
- Average note size (trend over time)
- **Class match rate** (% klas z theme.css vs random inline `style=""`) — kluczowe dla walidacji ADR-012
- Median age at finalize / at delete
- Top threads (by note count)
- Search recall heurystyka (top_score distribution)

**Tradeoffy:**
- Dodatkowy write per akcja. Negligible (<1ms).
- Privacy: wszystko lokalne, no telemetry leaves machine. Opt-in cloud-side analytics dla folio.app (osobno).

---

## ADR-018 — OG screenshot per publish

**Status:** Accepted (2026-05-11 refinement)

**Kontekst:** `folio.publish` daje URL. User wkleja w Telegram/Slack/iMessage. Domyślnie OG = bez obrazka = lame text preview. Z screenshotem = bogaty rich preview = drastycznie lepsza share UX.

**Decyzja:**
- Każdy `folio.publish` triggeruje screenshot pipeline w cloud:
  - Playwright headless na opublikowanym URL
  - Crop top 1200×630 (OG standard) — fold area
  - Save jako PNG do R2 / Vercel Blob
- Inject w opublikowany HTML:
  - `<meta property="og:image" content="..." />`
  - `<meta property="og:title" content="..." />`
  - `<meta property="og:description" content="<1st paragraph>" />`
- Cache strategy: w append-only modelu publikacje są immutable → bezproblemowy cache permanent.

**Tradeoffy:**
- Latency `publish`: bez OG ~2s, z OG ~5-8s (browser cold start). Akceptowalne — publish nie jest hot path.
- Koszt: ~$0.001 per publish (edge browser + storage). Marginalne.
- Operacyjne ryzyko Puppeteer breakages. Mitigation: vendor Playwright albo Cloudflare Browser Rendering API.



---

## 🔁 Refinement v3.1 amendments (2026-05-11)

- **ADR-014 amended:** żadnych „loose" not. Każda nota ma `thread_id`. Gdy agent go nie poda, Folio sam tworzy slug z tytułu. Daily bucket `notes/YYYY/MM/` znika.
- **ADR-015 amended:** `folio.publish` automatycznie ustawia `is_final=true` (implicit final on publish — jeśli share'owane, to wartościowe).
- **ADR-014 amended:** `folio.suggest_thread` jest **mandatory** przed każdym `folio.create` (Skill enforce + opcjonalnie MCP server może warning'ować gdy nie wywołano).

---

## ADR-019 — Proactive expiration surfacing (gated)

**Status:** Accepted (2026-05-11 v3.1)

**Kontekst:** Lifespan (ADR-015) auto-czyści noty po 30d. User nie zauważy, jeśli viewer banner jest jedynym sygnałem (rzadko otwiera viewer). Pytanie: czy agent ma proaktywnie informować „X not zniknie za N dni"?

**Decyzja:** Tak, ale z twardym gating'iem w Skill — żeby nie była Clippy-style irytacja.

**Mechanizm:**
1. **MCP tool:** `folio.list_expiring({ within_days?: number = 7, limit?: number = 10 })` → `[{ id, title, thread_id, days_left, type }]`. Tani SQL query po `expires_at`.
2. **Skill heuristics** — kiedy surface:
   - ✅ User wszedł w Folio-related convo (słowa: „folio", „notatka", „research", „porównanie", „publish"; albo agent użył folio.* tools w session).
   - ✅ Natural moment po `folio.publish` — agent może dorzucić: „BTW thread X ma jeszcze 2 noty wygasające, finalizować?".
   - ❌ Unrelated convo (Python helper, debugging, conversation o czymś innym) — żadnego Folio nudge.
   - ❌ Powtórnie ten sam `id` w 24h (idempotency).
   - ❌ Lista > 5 not naraz (przytłacza).
3. **Stateful gating:** Skill pamięta między sesjami które id już surface'ował — prosty cache `~/.folio/skill_state.json` z `{ last_surfaced: { id: timestamp } }`.

**Implicit final on publish:**
- `folio.publish` ustawia `is_final=true` automatycznie. Eliminuje 60% przypadków „ważna nota zniknęła" bez nudgowania.
- User może uncheckować przez `folio unfinalize <id>` jeśli to było publish ad-hoc.

**Tradeoffy:**
- Skill staje się lekko stateful — `skill_state.json` to plik 1-2KB.
- Ryzyko **KB creep** — Skill zaczyna „dbać" o noty across sessions, co zaprzecza idei „komunikacja, nie KB". Mitigation: surfacing tylko w Folio-related konwersacjach (gating ✅/❌).
- Bez tego — user nie zauważy że stracił coś ważnego. Z tym — minimalna disruption.

**Odrzucone:**
- Daily digest jako static HTML w `~/Folio/.digest/` → user musi go sam otworzyć, czego nie zrobi.
- macOS system notification → invasive dla pojedynczej feature.
- Email digest tygodniowy → dodaje infrę email, overkill dla MVP.



---

## ADR-020 — Theme system (hybrid CSS + prompt addendum)

**Status:** Accepted (2026-05-11 refinement)

**Kontekst:** Folio jako medium komunikacji wizualnej działa wtedy, kiedy wizualna paleta pasuje do gustu usera. Jeden narzucony theme (dark + purple) = potencjalny dealbreaker dla ludzi, którzy nienawidzą dark mode, edytorialnych puryst, fanów Apple minimalizmu albo tych, co chcą lekkiej/playful estetyki. Visual style to *medium*, nie ozdoba.

User-instynkt: theme jako prompt addendum w Skillu. Realnie: hybrid (CSS + prompt) jest mocniejszy.

**Decyzja:** Hybrid theme system.

**Mechanizm:**
1. **Theme = folder** `~/Folio/themes/<name>/`:
   - `theme.css` — CSS variables (kolory, fonty, spacing) + utility classes (.eyebrow, .lead, .card itd.)
   - `theme.md` — prompt addendum dla agenta: voice, structure, headings style, what to use, what to avoid
2. **Bundled 8 starter themes:** folio (default), newsroom, notebook, brutalist, linen, terminal, pastel, dossier. Mockup: `mockup-themes.html` w repo.
3. **User-extensible:** drop nowy folder `themes/myown/` z dwoma plikami → Folio go pickup'uje. Power-user feature.
4. **Selekcja theme'u:**
   - Default user-wide w `folio.config.json`: `theme: "newsroom"`
   - Per-note override w `folio.create({ theme: "terminal" })`
   - Skill może proaktywnie zaproponować: „to long-form research, użyć Newsroom?"
5. **Discovery:** MCP tool `folio.list_themes()` zwraca dostępne themes z ich `theme.md` summary → agent wie kiedy który zaproponować.

**Dlaczego oba (CSS + prompt), nie samo CSS lub sam prompt:**
- **Tylko CSS:** Agent generuje identyczne body dla wszystkich themes. Brutalist i Newsroom mają tę samą strukturę markupu, różnią się tylko kolorami/fontami. Niewystarczające — różne mood'y wymagają różnych decyzji strukturalnych:
  - Newsroom preferuje prose-forward + drop cap + lead w italic
  - Brutalist preferuje ALL CAPS + krótkie zdania + sparse bullets
  - Dossier preferuje sections „Subject/Summary/Field notes" + checkbox bullets
  - Notebook preferuje pytania retoryczne + hedging
- **Tylko prompt:** Agent kreatywnie generuje, brak baseline wizualnego → noty tego samego theme'u wyglądają nieprzewidywalnie.
- **Hybrid:** CSS = twarda baza (kolory, fonty, spacing, base typography). Prompt = strukturalne i tonowe decyzje (jakie tagi preferować, ton, słownictwo, długość zdań). Razem = spójność wewnątrz theme'u + zróżnicowanie między.

**Token cost:**
- Skill prompt rośnie o ~150-300 tokenów (aktualny `theme.md`). Akceptowalne.
- Hosted profile (ADR-012) zostaje — agent generuje semantykę, theme.css aplikuje styl. Token-saving claim 40-60% wciąż w mocy.
- Standalone build (ADR-012, ADR-018) inline'uje aktualnie wybrany theme przy publish. Każda publikacja = freeze theme'u w czasie.

**Edge cases:**
- **Theme switching post-create:**
  - Hosted: trivial — viewer re-renderuje z nowym theme.css (kolory/fonty się zmieniają, struktura zostaje).
  - Standalone: rebuild via `folio render <id> --theme=<new>`.
  - Cloud published: immutable (ADR-013). Nowy theme = nowa publikacja.
- **Skill addendum specyficzny vs. struktura HTML:** Notatka zrobiona pod Brutalist (krótkie zdania, ALL CAPS) wygląda dziwnie w Pastel kosmetycznie. Switching działa, ale „natywny" theme = re-create przez agenta.

**Tradeoffy:**
- 2× artefakt utrzymania per theme (CSS + .md). Akceptowalne dla 8-15 themes.
- Custom themes wymagają podstaw CSS + rozumienia prompt engineering. Power-user feature.
- Większy footprint Skill prompta. Mitigation: theme.md max 300 tokenów, lazy-load tylko aktualny.

**Update w sprintach:**
- **S2 Templates:** bundle 8 starter themes (CSS + prompt.md), nie pojedynczy theme.css. Test każdego z sample notami research/comparison/technical.
- **S3 MCP:** dodać `theme?: string` param do `folio.create`. Nowy tool `folio.list_themes()`.
- **S4 Skill:** Skill zna listę themes + kiedy proponować. Inject `theme.md` jako addendum przed generowaniem body_html.
- **S7 Polish:** theme switcher w viewerze (dla hosted profile re-render).

**Odrzucone:**
- Tylko CSS — brak strukturalnej spójności (uzasadnione wyżej).
- Tylko prompt — brak baseline wizualnego.
- ML-based theme selection — premature, default + Skill suggestion wystarczą.
- Theme marketplace — backlog dla open source release w S7+.


---

## 2026-05-11 — Default theme = Linen

**Decyzja:** Domyślny theme dla świeżych instalacji = **Linen** (ADR-020 update).

**Uzasadnienie:** Najmniej kontrowersyjny dla niedevs. Apple polish jako pierwsze wrażenie. Dev-targeted users zmienią na Folio default; reszta zostanie na Linen.

**Implementacja:** `folio init` ustawia `theme: "linen"` w `folio.config.json`.
