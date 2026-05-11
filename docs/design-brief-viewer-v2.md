# Folio Viewer — Design Brief v2

> Brief dla Claude Design / designera. Zakres: **viewer chrome** (interfejs aplikacji), NIE: rendering treści notatek (tym zarządzają osobne theme'y w `themes/`).

---

## TL;DR (jeśli masz 30 sekund)

Folio to lokalny webowy interfejs (`http://127.0.0.1:4810`) do przeglądania HTML-owych notatek wygenerowanych przez AI agenty. Mam działającą wersję 1, ale layouty (lista, search, threads, note view) są kompromisem MVP — funkcjonalne, ale design nie odpowiada jakości wordmarka i theme'ów. Potrzebuję projektu UI/UX viewer chrome z taste'em, na poziomie tego, czego oczekujemy od narzędzia komunikacyjnego w 2026.

---

## Co to jest Folio

**Folio = warstwa wizualnej komunikacji między AI agentami a człowiekiem.** Po pivocie v3 NIE jest bazą wiedzy ani Obsidianem. To medium do *bieżącej* rozmowy — agent generuje wizualnie bogate HTML (research, comparison, technical), ląduje w `~/Folio/threads/<topic>/<slug>.html`, user otwiera w przeglądarce w lokalnym viewerze, opcjonalnie share'uje przez `folio export --standalone`.

Pełny kontekst:
- `~/Projects/Folio/README.md` — szybki overview
- `Obsidian://Projekty/Folio/Folio.md` — pełny pitch i pivot
- `Obsidian://Projekty/Folio/Decisions.md` — ADR-009 (pivot), ADR-014 (append-only), ADR-020 (themes)

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
- **Wordmark / logo** — już ustalone jako v08 lockup. Zobacz `~/.openclaw/workspace/folio-wordmarks-v5.html` (wersja 08, ostatnia). Lockup: `folio.` w Familjen Grotesk 500 + thin divider + `VISUAL COMM FOR AGENTS` w JetBrains Mono.
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

## Materiały do przeczytania (w kolejności priorytetu)

1. **Live app:** `http://127.0.0.1:4810/` — jak chodzi, otwórz, kliknij wszędzie, zauważ co siada
2. **Aktualny kod viewera:** `~/Projects/Folio/src/viewer/render.ts` — to dyktuje obecny CSS i strukturę
3. **Mockup themes:** `~/Projects/Folio/docs/mockup-themes.html` — 8 theme'ów jako wizualny styleguide (pokazuje brand DNA na różnych ekstremach)
4. **Pre-rebrand mockupy** (referencja historyczna, NIE aktualny brand): `docs/plan-dzialania.html`, `docs/plan-implementacji.html`, `docs/mockup-viewer.html` — pokazują co kiedyś było zaplanowane przed pivotem brand. Możesz wyciągnąć patterny strukturalne, ALE kolory/fonty traktuj jako out-of-date.
5. **Wordmark:** `~/.openclaw/workspace/folio-wordmarks-v5.html` (wersja 08)
6. **SKILL stylebook** (jak agenty piszą HTML treści): `~/Projects/Folio/skills/folio/STYLEBOOK.md`

---

## Konkretne pain pointy (od użytkownika, real feedback)

1. **„Lista nieczytelna"** — robiłem refactor (compact rows ~36px), poprawiło, ale wciąż nie ma research-grade typografii / hierarchii. Każdy element wygląda tak samo ważny.

2. **„Sztuczne zwężenie layoutu w themie"** — wraps 760-880px to ergonomiczne dla reading line length, ale on screen 1400px+ to wygląda jak ucięta kartka pośrodku ekranu. Może zostawić wide na chrome, narrow tylko na treść?

3. **Sidebar w note view (`/n/:id`)** — 280px po lewej z metadanymi + akcjami. Ergonomicznie OK ale wizualnie ciężki. Akcje (Mark as final, Export) są ważne, ale teraz toną w metadanych.

4. **Search results layout** — wyniki dzielą się na „Wątki" i „Notatki" w dwóch sekcjach, ale wizualnie wyglądają jak ten sam typ rzeczy. Brakuje hierarchii „tu są wątki (czyli grupy), tu są pojedyncze trafienia".

5. **Brak motion / micro-interactions** — wszystko jest static. Hover'y są subtle ale nie ma poczucia *aliveness*. To narzędzie do *komunikacji*, powinno czuć żywe.

6. **Mobile responsive nieprzetestowany** — działa technicznie (`@media max-width: 720px`) ale nikt nie pomyślał o tym jak feels na phone.

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

1. **4 statyczne mockupy HTML** w `~/Projects/Folio/docs/redesign/`:
   - `redesign-list.html` — `/`
   - `redesign-search.html` — `/search?q=foo`
   - `redesign-threads.html` — `/threads`
   - `redesign-note.html` — `/n/:id` (note + sidebar + iframe placeholder)
   Każdy = self-contained, na prawdziwych mockowych danych (3-5 notatek), działający w przeglądarce.

2. **CSS extracted** — to co miałoby trafić do `src/viewer/render.ts` w `VIEWER_CSS` const. Idealnie jako osobny plik `redesign-viewer.css` żebym mógł diffować z obecnym.

3. **Notki w README mockupu** — co się zmieniło i dlaczego (krótkie, 1-2 linijki per decyzja).

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

---

**Wszystkie ścieżki absolute, repo w `~/Projects/Folio/`, live viewer na `127.0.0.1:4810`. Pytaj o klucz dostępu jeśli masz.**
