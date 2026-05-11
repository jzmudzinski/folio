---
name: folio
description: Create visually-rich HTML knowledge artifacts via Folio (folio-mcp). Use when the user asks for research, comparison, deep dive, technical doc, ADR, specyfikacja, „zrób mi notatkę", „porównaj X i Y", „TL;DR ten URL", or any output that would benefit from rich visual layout (tables, scorecards, diagrams, color-coded findings). Also proactively after producing long structured responses — propose saving to Folio. Append-only model: never edits; new version = new note in same thread folder.
---

# Folio Skill

> Generuj wizualnie bogate HTML-owe artefakty komunikacyjne via Folio. Markdown w czacie ma flat hierarchy; Folio daje scorecards, color coding, in-page nav, tabele.

## Quick reference

- **Repo:** `~/Projects/Folio`
- **Storage:** `$FOLIO_HOME` (default `~/Folio/`)
- **MCP:** `folio-mcp` (zobacz `docs/mcp-setup.md`)
- **Viewer:** `folio serve` → http://127.0.0.1:4810
- **Tools:** `folio.create`, `folio.get`, `folio.list`, `folio.search`, `folio.finalize`, `folio.suggest_thread`, `folio.list_expiring`, `folio.list_themes`
- **Stylebook:** `skills/folio/STYLEBOOK.md` (class contract z theme.css)
- **Examples:** `skills/folio/examples/<typ>/`

---

## Kiedy używać Folio

**TAK (triggers):**
- „research [temat]", „rozszerz", „streść", „deep dive", „TL;DR ten URL"
- „porównaj X i Y", „compare X vs Y", „różnice między"
- „ADR", „decyzja techniczna", „specyfikacja", „dokumentacja"
- „zrób mi notatkę o…", „zapisz to do folio"
- Proaktywnie po długich strukturalnych odpowiedziach (gdy w czacie wyprodukowałeś rozbudowany artefakt, zaproponuj: „Zapisać do Folio jako [typ]?")
- Po dłuższej rozmowie debriefującej (rozmowa rekrutacyjna, meeting) → zaproponuj `journal`

**NIE (anti-triggers):**
- Krótka odpowiedź konwersacyjna („która godzina?", „co to RAG?" gdy wystarczy 2 zdania)
- Edycja istniejącego pliku poza Folio (Folio nie edytuje plików)
- Daily note, projekty zarządzane manualnie w Obsidian
- Jednorazowy snippet kodu odpowiadający na dokładne pytanie (chyba że user wprost prosi „zapisz to")

---

## Pętla obowiązkowa (każde użycie Folio)

```
1.  folio.suggest_thread({ title: <proposed title> })
    ↳ Jeśli `matches.length > 0` → użyj istniejącego `thread_id`.
    ↳ Jeśli pusto → użyj `proposed_new_thread` z response (nowy thread).

2.  (opcjonalnie) folio.list_themes()  
    ↳ Tylko gdy nie pewny theme. Cache w sesji — nie wołaj wielokrotnie.

3.  Wygeneruj body_html zgodny z STYLEBOOK.md aktualnego theme'u.

4.  folio.create({ type, title, body_html, thread_id, theme?, tags? })
    ↳ Theme z user config (domyślnie linen) jeśli nie nadpisujesz świadomie.
    ↳ Theme_profile zostaw default ("hosted").

5.  W odpowiedzi do usera:

    MEDIA:<local_url>
    
    <3-5 linijek TL;DR — nie cała notatka, tylko esencja co tam jest>
    
    <Tagi: tag1, tag2>  ← opcjonalnie, gdy non-obvious

6.  ZAPAMIĘTAJ `id` w kontekście sesji — gdy user prosi o iterację
    („inna wersja", „dopracuj"), użyj tego samego `thread_id`
    do nowej noty (NIE edytujesz starej — ADR-014 append-only).
```

---

## Wybór `type`

| Sygnał w prompcie | Type | Template (slot data) |
|---|---|---|
| „porównaj", „vs", „różnice między", scorecard | `comparison` | `comparison.html.eta` |
| „research", „deep dive", „wszystko o", „streszczenie URL" | `research` | `research.html.eta` |
| „debrief", „dziennik", „podsumowanie dnia / spotkania" | `journal` | (custom body_html — brak dedykowanego template'u w MVP) |
| „ADR", „decyzja techniczna", „specyfikacja", „proposal" | `technical` | `technical.html.eta` |
| „zapisz to" + krótka treść (<400 słów), single point | `snippet` | (custom body_html, single card layout) |

Gdy niejasne → spytaj jednym pytaniem albo wybierz `research` jako safe default.

---

## Wybór `theme`

Default user-wide: zwykle **linen** (Apple-grade minimal). Override gdy:

| Kontekst | Theme | Dlaczego |
|---|---|---|
| Public-facing report / customer-facing | `linen` | Polish, neutral, czytelny dla niedevs |
| System design, ADR, code-heavy | `folio` | Dev-targeted, dark, mono, gradient h1 |
| Long-form journalism, formal report | `newsroom` | Serif gravitas, ciszy bullet'om |
| Personal brainstorm, journal, exploratory | `notebook` | Handwritten headers, casual, hedging OK |
| Strong opinion, manifesto, polemika | `brutalist` | ALL CAPS, bez ozdób, statement piece |
| Log analysis, debugging, system internals | `terminal` | Mono, green-on-black, code-like |
| Personal soft communication, gentle | `pastel` | Warm rounded, soft accents |
| Investigation, OSINT, deep dossier | `dossier` | Typewriter, manila, "classified" stamp |

**Reguła:** jeśli user nie powiedział, użyj defaultu. Proponuj override TYLKO jeśli kontekst silnie pasuje (np. user pisze „zrób mi ADR" → sugeruj `folio` lub `terminal`).

**Po wyborze:** `folio.list_themes` zwraca `prompt_addendum` dla każdego — przeczytaj odpowiedni przed generowaniem body. Stylebook theme'u dyktuje strukturę markupu (newsroom prose-forward, brutalist krótkie zdania, etc.).

---

## Stylebook — kontrakt z theme.css

Pełna spec w `STYLEBOOK.md` w tym samym folderze. W skrócie, używaj **klas utility z theme.css**:

```html
<span class="eyebrow">Research · AI / ML</span>
<h1>Tytuł</h1>
<p class="lead">Lead 1-2 zdania.</p>

<h3>Sekcja</h3>
<p>Treść.</p>
<ul><li>Bullet</li></ul>

<div class="cards">
  <div class="card">
    <h3>Karta</h3>
    <p>Opis</p>
  </div>
</div>

<table>...</table>

<div class="verdict">
  <h3>Werdykt</h3>
  <p>Rekomendacja.</p>
</div>

<span class="pill good">final</span>
<span class="pill bad">deprecated</span>
<span class="pill mid">wip</span>
<span class="pill acc">accent</span>
```

**Pożądane klasy:** `.eyebrow`, `.lead`, `.card`, `.cards`, `.verdict`, `.pill` (variants: `.good`, `.bad`, `.mid`, `.acc`, `.info`).

**NIE:**
- ❌ `style="..."` inline (poza wyjątkowymi przypadkami — bar width, custom accent)
- ❌ `<style>`, `<script>`, `<html>`, `<head>`, `<body>`, `<title>`, `<meta>` — to template wraps your fragment
- ❌ `<font>`, `<center>`, deprecated HTML4 tagi
- ❌ Surowe kolory hex w atrybutach — używaj klas

**Sanitizer Folio drop'uje** nie-allowed tagi i `<script>`. Twoje czyste semantyczne HTML jest najlepsze.

---

## Tagowanie

`tags` w `folio.create`:
- Konkretne: `["postgres", "saas", "comparison"]`, nie ogólne `["analiza"]`
- Lowercase, kebab-case
- 2-5 tagów per notatka, nie więcej
- Tag = co użyje user gdy będzie szukał

---

## Anti-patterns

- ❌ **Spam folio.create** dla rzeczy, które powinny być w pamięci agenta lub w czacie (krótka odpowiedź jak „co to RAG?")
- ❌ **Pomijanie folio.suggest_thread** → tworzy duplikat threadów. ZAWSZE sprawdź najpierw.
- ❌ **Generowanie body bez znajomości stylebook'a** → notatki wyglądają niespójnie
- ❌ **Pominięcie metadanych** (tags) — utrudnia retrieval
- ❌ **Pisanie HTML-a inline-styled jak z 2005** — używaj klas z theme.css
- ❌ **Edycja**: jeśli user prosi „popraw" → tworzysz NOWĄ notę w tym samym threadzie (append-only, ADR-014)
- ❌ **Markowanie `is_final: true` na własną rękę** — to decyzja usera (z viewera/CLI/explicit prośby)

---

## Surfacing wygasających not (proaktywne)

Per ADR-019 — twardy gating:

**TAK surface:**
- ✅ User wszedł w Folio-related convo (słowa: „folio", „notatka", „research", użył folio.* w session)
- ✅ Natural moment po `folio.create` lub `folio.publish` — „BTW thread X ma jeszcze 2 noty wygasające"

**NIE surface:**
- ❌ Niezwiązana convo (Python helper, debugowanie czegoś innego)
- ❌ Powtórnie ten sam `id` w 24h (idempotency)
- ❌ Więcej niż 5 not naraz — przytłacza

Mechanizm:
```
folio.list_expiring({ within_days: 7, limit: 5 })
↳ Jeśli array non-empty I jesteś w Folio convo:
   "BTW masz <N> not wygasających: <title 1, title 2, …>.
    Finalizować któryś? `folio finalize <id>`."
```

---

## Edycja → tworzenie nowej noty w tym samym threadzie

Gdy user mówi „popraw to / inna wersja / rozszerz o X":

```
1. Identyfikuj `thread_id` aktualnej (lub szukaj przez folio.search).
2. folio.create({ ..., thread_id: <ten sam> })
3. W odpowiedzi:
   MEDIA:<new_local_url>
   <TL;DR nowej wersji + co się zmieniło względem poprzedniej>
4. User zobaczy w thread view obie wersje. Wybierze finalną klikiem.
```

**NIE** wołaj `folio.finalize` na poprzedniej wersji — user sam decyduje która jest "ta właściwa".

---

## Examples (few-shot)

W folderze `examples/`:

- `research/` — research o RAG vs Fine-Tuning
- `comparison/` — Postgres vs MySQL vs SQLite dla SaaS
- `technical/` — ADR-style decyzja
- `snippet/` — krótka notka

Każdy ma `prompt.md` (user prompt) i `output.html` (oczekiwany body_html).

---

## Test przed mergem (manual)

1. „Porównaj Postgres vs SQLite dla małego SaaS" → `comparison`, nowy thread.
2. „Inna wersja, krótsza" → `comparison`, ten sam thread, nowa nota.
3. „Co wiem o RAG?" → `folio.search "RAG"`, pokaż wyniki, NIE twórz nowej.
4. „Co to FTS5?" (krótkie) → bez Folio, zwykła odpowiedź (anti-trigger).
5. „Zapisz to" po długiej odpowiedzi → `research` lub `snippet`.
