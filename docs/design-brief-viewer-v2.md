# Folio Viewer — Design Brief v2

> Brief dla Claude Design / designera. Zakres: **viewer chrome** (interfejs aplikacji), NIE: rendering treści notatek (tym zarządzają osobne theme'y w `themes/`).
>
> Cały codebase jest w kontekście — wszystkie ścieżki poniżej są względem repo root.

---

## TL;DR (jeśli masz 30 sekund)

Folio to lokalny webowy interfejs (`http://127.0.0.1:4810`) do przeglądania HTML-owych notatek wygenerowanych przez AI agenty. Mam działającą wersję 1, ale layouty (lista, search, threads, note view) są kompromisem MVP — funkcjonalne, ale design nie odpowiada jakości wordmarka i theme'ów. Potrzebuję projektu UI/UX viewer chrome z taste'em, na poziomie tego, czego oczekujemy od narzędzia komunikacyjnego w 2026.

---

## Co to jest Folio

**Folio = warstwa wizualnej komunikacji między AI agentami a człowiekiem.** Po pivocie v3 NIE jest bazą wiedzy ani Obsidianem. To medium do *bieżącej* rozmowy — agent generuje wizualnie bogate HTML (research, comparison, technical), ląduje w `~/Folio/threads/<topic>/<slug>.html`, user otwiera w przeglądarce w lokalnym viewerze, opcjonalnie share'uje przez `folio export --standalone`.

Pełny kontekst:
- `README.md` — szybki overview, komendy, status
- `docs/planning/Folio.md` — pełny pitch i pivot (strategia)
- `docs/planning/Decisions.md` — wszystkie ADRy (ADR-009 pivot, ADR-014 append-only, ADR-020 themes, etc.)
- `docs/planning/Architecture.md` — high-level architektura
- `docs/planning/Changelog.md` — historia implementacji, decyzje w czasie

---

## Co masz zaprojektować

**4 stany viewera** (czyli to co user widzi w przeglądarce):

| Route | Co tam jest |
|---|---|
| `/` | Lista wszystkich aktywnych not, grouping po dacie, filtry po typie + statusie |
| `/search?q=foo` | Wyniki w 2 sekcjach: matching wątki + matching noty (z FTS snippet highlight) |
| `/threads` | Lista wszystkich wątków (folder grouping) z count, latest, final marker |
| `/n/:id` | Pojedyncza nota — sidebar z metadanymi + akcjami po lewej, treść (iframe) po prawej |

Plus:
- Top bar (sticky, na wszystkich stronach): wordmark `folio.` | tagline | search | nav
- `/t/:thread_id` — widok pojedynczego wątku (lista not w tej kolekcji, chronologicznie)
- `/stats` — dashboard z metrykami

---

## Czego NIE projektujesz

- **Renderowanie treści notatek** — to jest pre-zaprojektowane jako 8 osobnych theme'ów (linen default, folio noir, newsroom, notebook, brutalist, terminal, pastel, dossier). Każdy theme = `themes/<name>/theme.css` + `theme.md`. Treści not nie ruszamy.
- **Wordmark / logo** — już ustalone jako v08 lockup. Zobacz `docs/wordmark-v05.html` (wersja 08 z 10 variations). Lockup: `folio.` w Familjen Grotesk 500 + thin divider + `VISUAL COMM FOR AGENTS` w JetBrains Mono.
- **Backend, API, storage** — działają, nie ruszaj.

---

## Brand DNA (mandatory)

**Palette:**
- Default light theme (Linen): bg `#f5f3ee` warm cream, text `#0a0a0a`, accent `#ff5a1f` orange
- Dark variant (Folio noir): bg `#0a0a0a`, text `#fafaf7`, ten sam orange `#ff5a1f`
- Muted: `#6b6b66` / `#a8a89e` (warm gray)
- Border: `rgba(10,10,10,0.10)` na light, `rgba(255,255,255,0.08)` na dark

**Typography:**
- **Headings:** `Familjen Grotesk` (500 weight, letter-spacing -0.025em)
- **Body:** `Inter` (system fallback)
- **Italic emphasis + serif lead:** `Instrument Serif` italic
- **Metadata, code, technical info:** `JetBrains Mono`

Wszystko z Google Fonts CDN — możesz polegać na fontach.

**Vibe:** editorial-meets-product. Calm, archival, ale żywe. Nie SaaS dashboard. Nie Notion. Nie Linear. Bardziej… *FT.com meets Things 3 meets Are.na*.

---

## 8 themes w repo (`themes/<name>/theme.css` + `theme.md`)

| Theme | wrap-max | Wibe | Best for |
|---|---|---|---|
| `linen` ⭐ default | 880px | Warm cream + orange. Familjen Grotesk + Instrument Serif italic lead | Public reports, polished docs |
| `folio` (noir) | 960px | Dark inverse Linen, ten sam orange | Dev-targeted, ADR, system specs |
| `newsroom` | 720px | Source Serif Pro + czerwony accent. Editorial gravitas | Long-form research, formal reports |
| `notebook` | 760px | Caveat handwritten + ruled-line bg + blue ink | Brainstorm, journal, sketchy thoughts |
| `brutalist` | 920px | Helvetica 900 ALL CAPS + 6px drop shadows | Manifesto, hot takes |
| `terminal` | 880px | JetBrains Mono everywhere + green-on-black | System docs, log analysis, debugging |
| `pastel` | 820px | Plus Jakarta Sans rounded + peach/sage | Gentle communication |
| `dossier` | 780px | Courier Prime + manila + CONFIDENTIAL stamp | Investigation, OSINT |

**Te wrap-max są fair game do rewizji** — pain point #2 niżej. Na 1400px+ ekranie wąska kartka pośrodku może wyglądać niepotrzebnie obco. Opcja: wide chrome + narrow content column.

---

## Materiały do przeczytania (w kolejności priorytetu)

1. **Live app:** `http://127.0.0.1:4810/` — jak chodzi, otwórz, kliknij wszędzie, zauważ co siada
2. **Aktualny kod viewera:** `src/viewer/render.ts` — to dyktuje obecny CSS i strukturę (tam jest `VIEWER_CSS` const)
3. **Viewer routes:** `src/viewer/server.ts` — co user może hit'nąć
4. **Mockup themes:** `docs/mockup-themes.html` — 8 theme'ów jako wizualny styleguide (porównaj DNA na różnych ekstremach)
5. **Wordmark:** `docs/wordmark-v05.html` — 10 variations of `folio.` lockup, wersja 08 to inline lockup używany w top barze
6. **Pre-rebrand mockupy** (referencja historyczna, NIE aktualny brand): `docs/plan-dzialania.html`, `docs/plan-implementacji.html`, `docs/mockup-viewer.html` — pokazują co kiedyś było zaplanowane przed pivotem brand. Możesz wyciągnąć patterny strukturalne, ALE kolory/fonty traktuj jako out-of-date.
7. **SKILL stylebook** (jak agenty piszą HTML treści): `skills/folio/STYLEBOOK.md`
8. **Theme.md per theme** — każdy theme ma `themes/<name>/theme.md` z opisem voice/structure/avoid

---

## Konkretne pain pointy (od użytkownika, real feedback)

1. 🔴 **"Lista nieczytelna"** — robiłem refactor (compact rows ~36px), poprawiło, ale wciąż nie ma research-grade typografii / hierarchii. Każdy element wygląda tak samo ważny.

2. 🔴 **"Sztuczne zwężenie layoutu w themie"** — wraps 720-960px to ergonomiczne dla reading line length, ale na screen 1400px+ wygląda jak ucięta kartka pośrodku ekranu. Może zostawić wide na chrome, narrow tylko na treść? Dotyczy zarówno `:root --vbg`/`--wrap-max` w viewer chrome, jak i `:root --wrap-max` per theme.

3. 🟡 **Sidebar w note view (`/n/:id`)** — 280px po lewej z metadanymi + akcjami. Ergonomicznie OK ale wizualnie ciężki. Akcje (Mark as final, Export) są ważne, ale teraz toną w metadanych.

4. 🟡 **Search results layout** — wyniki dzielą się na „Wątki" i „Notatki" w dwóch sekcjach, ale wizualnie wyglądają jak ten sam typ rzeczy. Brakuje hierarchii „tu są wątki (czyli grupy), tu są pojedyncze trafienia".

5. 🟡 **Brak motion / micro-interactions** — wszystko jest static. Hover'y są subtle ale nie ma poczucia *aliveness*. To narzędzie do *komunikacji*, powinno czuć żywe.

6. 🔴 **Mobile responsive nieprzetestowany** — działa technicznie (`@media max-width: 720px`) ale nikt nie pomyślał o tym jak feels na phone.

---

## Real data shape (żebyś projektował na prawdziwych danych)

**`/api/list`** — array of:
```json
{
  "id": "01KRB...",
  "slug": "rag-vs-fine-tuning",
  "title": "RAG vs Fine-Tuning",
  "type": "research|comparison|technical|journal|snippet",
  "theme": "linen|folio|newsroom|...",
  "thread_id": "rag-vs-finetuning",
  "is_final": false,
  "created": "2026-05-11T...",
  "expires_at": "2026-06-10T..." | null,
  "word_count": 847,
  "summary": "Pierwsze 240 znaków plain text z body...",
  "tags": ["ai", "rag", "saas"]
}
```

**`/api/threads`** — array of: `{ thread_id, count, latest, final_count }`

**`/api/search?q=foo`** — array of: SearchHit (jak NoteMeta + `score`, `snippet` z `<mark>` highlights)

Live endpoints działają. Możesz `curl` żeby zobaczyć realne dane.

---

## Deliverables

W kolejności priorytetu (1 = must, 4 = nice):

1. **4 statyczne mockupy HTML** w `docs/redesign/`:
   - `redesign-list.html` — `/`
   - `redesign-search.html` — `/search?q=foo`
   - `redesign-threads.html` — `/threads`
   - `redesign-note.html` — `/n/:id` (note + sidebar + iframe placeholder)
   Każdy = self-contained, na prawdziwych mockowych danych (3-5 notatek), działający w przeglądarce.

2. **CSS extracted** — to co miałoby trafić do `src/viewer/render.ts` w `VIEWER_CSS` const. Idealnie jako osobny plik `docs/redesign/viewer.css` żebym mógł diffować z obecnym.

3. **Notki w README mockupu** (`docs/redesign/README.md`) — co się zmieniło i dlaczego (krótkie, 1-2 linijki per decyzja).

4. **Mobile responsive variant** dla każdego stanu — pokazany jako drugi viewport w mockupie, albo osobny plik.

---

## Tech constraints

- **Server-rendered**, no React, no build step. Wszystko musi działać jako jeden plik CSS + plain HTML wygenerowany przez Bun.serve.
- **Vanilla JS OK** ale minimalne (~100-200 LOC max), tylko dla micro-interactions. NIE pisz frameworków.
- **Google Fonts CDN** OK do fontów. Nic innego z CDN bez pytania.
- **Latest Chrome, Safari, Firefox.** Nie wspieraj IE/starych Edge.
- **CSS variables wszędzie** (już tak działa, zachowaj).
- **No icon library deps** — emoji (📂 ⭐ ⏱ ★) OK, SVG inline OK, nic z fontami ikon.

---

## Out of scope

- Treść/typografia w `<article>` (themes' job)
- Logika storage/MCP
- S6 cloud (`folio.app`) — to inny projekt
- Performance optimization (load times już są <100ms, nie martw się tym)

---

## Iteration loop

Wrzucasz wersję 1 → ja odpalam w przeglądarce → daję feedback per stan → ty iterujesz. Spodziewam się 2-3 rund. Bez czasowego wymagania, ale tydzień to dobry baseline.

Jak będziesz miał pytania, pisz przez Folio note do mnie:

```
folio.create({
  type: "technical",
  title: "Design questions — round 1",
  thread_id: "viewer-redesign-v2",
  theme: "newsroom",  // dla brief'ów / komunikacji formalnej
  body_html: "<h3>Pytania</h3>..."
})
```

---

## Success criteria

Wiem że dobrze wyszło jeśli:

- Po otwarciu `/` od razu rozumiem co tu jest, co najnowsze, co działa
- Search results pokazują wątki jako wątki, noty jako noty — wizualnie inne
- Note view (`/n/:id`) → akcja „Mark as final" jest oczywista i atrakcyjna do kliknięcia, sidebar nie zaprzecza treści po prawej
- Mobile (phone) flow działa bez kombinowania
- Wizualnie poczułbym że to *jest* narzędzie do komunikacji, nie kolejny SaaS dashboard
