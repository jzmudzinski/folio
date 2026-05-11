# 🎨 Folio — Templates & Theme

> Jedno źródło stylu. Każda notatka spójna, ale standalone (po inline'owaniu).

---

## Filozofia

- **Jeden theme.** Variables + utility classes. Bez Tailwind-build, bez React.
- **Templates dziedziczą po `_base`.** Slot dla treści + opcjonalne style overrides.
- **Inline przy zapisie.** Gotowy plik HTML nie zależy od żadnego CSS poza tym co ma w `<style>` w head.
- **Polish > spartan.** Notatki mają wyglądać jak ten od 2026-05-11 (porównanie Obsidian/Affine/Trilium).

---

## theme.css (CSS variables)

```css
:root {
  /* Surface */
  --bg: #0b0d12;
  --bg-2: #11141c;
  --panel: #161a24;
  --panel-2: #1c2230;
  --border: #262d3d;

  /* Text */
  --text: #e7ecf3;
  --muted: #8a93a6;

  /* Accent (per-template override) */
  --accent: #7c5cff;
  --accent-2: #1aaaff;
  --accent-3: #f59e0b;

  /* Semantic */
  --good: #34d399;
  --bad: #f87171;
  --mid: #fbbf24;

  /* Type */
  --font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Inter, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", "SF Mono", ui-monospace, monospace;
  --leading: 1.55;
}

/* Light mode opt-in */
[data-theme="light"] {
  --bg: #f8fafc;
  --bg-2: #ffffff;
  --panel: #ffffff;
  --panel-2: #f1f5f9;
  --border: #e2e8f0;
  --text: #0f172a;
  --muted: #64748b;
}
```

Plus utility classes: `.eyebrow`, `.section`, `.pill {.good|.mid|.bad}`, `.card{.o|.a|.t}`, `.cards`, `.pcCol`, `.verdict`, `.bars`, `.scoregrid`, `.table-wrap`.

(W kodzie repo → `templates/theme.css`, bundled jako stała w `dist/`.)

---

## `_base.html.eta`

```html
<!doctype html>
<html lang="<%= it.lang || 'pl' %>" data-theme="<%= it.theme || 'dark' %>">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="folio:id" content="<%= it.id %>">
  <meta name="folio:type" content="<%= it.type %>">
  <meta name="folio:created" content="<%= it.created %>">
  <meta name="folio:updated" content="<%= it.updated %>">
  <meta name="folio:tags" content="<%= (it.tags || []).join(',') %>">
  <meta name="folio:links" content="<%= (it.links || []).map(l => l.dst_id).join(',') %>">
  <title><%= it.title %></title>
  <style><%~ it.theme_css %></style>
  <% if (it.template_css) { %>
    <style><%~ it.template_css %></style>
  <% } %>
</head>
<body>
  <main class="wrap">
    <%~ it.content %>
  </main>
  <script type="application/json" id="folio-metadata">
    <%~ JSON.stringify(it.metadata) %>
  </script>
</body>
</html>
```

Build pipe: `theme.css` + `template.css` (per typ) wczytane raz na start, embedowane przy render.

---

## Typy notatek

### `comparison`

**Use case:** porównanie 2-5 narzędzi/opcji.

**Layout:**
- header (eyebrow, h1 z kolorami akcentów, subtitle)
- `.cards` (1 karta per pozycja: tag, h2, opis, scoregrid z bars)
- `<section>` z `.table-wrap` (pełna tabela funkcji × pozycji)
- `<section>` z `.prosCons` (3 kolumny, plusy/minusy per opcja)
- `.verdict` (rekomendacja "kiedy wybrać")
- `<footer>` (data, źródła)

**Wbudowane sloty (Eta):**
```
{ title, subtitle, items: [{ name, accent, tag, desc, scores: [{label, value}] }],
  features: [{ name, values: [...] }], pros_cons: [{...}], verdict: "..." }
```

### `research`

**Use case:** głębsze opracowanie tematu, streszczenie URL-a, deep dive.

**Layout:**
- header (eyebrow="Research", h1, subtitle z TL;DR w 2 zdaniach)
- `<section class="tldr">` — bullet list 3-5 kluczowych punktów
- `<section>` z deep dive (h2 + paragrafy, kod, cytaty)
- `<section class="sources">` — linki / cytaty
- `<section class="open-questions">` — co dalej / co niejasne

### `journal`

**Use case:** chronologiczne, debriefe, dziennik decyzji.

**Layout:**
- header z datą duże + opcjonalnie mood/tag (kolorek)
- `<section>` per "wpis godzinowy"
- `.timeline` (sidebar z timestampami)
- footer z linkami do poprzedniego/następnego journala

### `technical`

**Use case:** ADR-y, specyfikacje, dokumentacja.

**Layout:**
- header (eyebrow="ADR / Spec", h1, status pill)
- `<section>` "Kontekst"
- `<section>` "Decyzja" (highlight border-left)
- `<section>` "Konsekwencje"
- code blocks z highlight.js (inline CSS dla teł)
- `<section>` "Alternatywy odrzucone"

### `snippet`

**Use case:** krótka notka, fragment, "zapisz to".

**Layout:**
- Single card, h1 + body + tag list. Bez sekcji.
- Max ~400 słów. Powyżej → research.

---

## Stylebook dla LLM (kontrakt)

W `STYLEBOOK.md` (osobny plik obok SKILL.md) wymieniamy:
- Listę dozwolonych klas i kiedy ich używać.
- Przykłady "tak rób" / "nie rób".
- Typowe error patterny (inline kolory hex zamiast var(--accent)).

LLM dostaje stylebook jako część promptu przy generowaniu body_html — gwarantuje spójność.

---

## Custom templates

Userskie templates: `~/Folio/templates/<name>.html.eta` (precedence > bundled).

`folio template list` / `folio template show <name>` / `folio template scaffold <name>` (kopiuje bundled jako punkt startowy).

---

## Highlighting

- Code blocks: highlight.js przepuszczane przy renderze, inline'owany generated CSS w `<style>` tej notatki (theme: github-dark / atom-one-light).
- Lazy: tylko jeśli notatka zawiera `<pre><code>`.

---

## Responsywność

- Wrap max-width 1200px.
- Cards grid → 3 kolumny desktop, 1 kolumna < 900px.
- Tabele → scroll-x wewnątrz `.table-wrap`.
- Typografia: clamp(16-20px) dla body, clamp(32-52px) dla h1.

---

## Print / PDF

- `@media print` w theme: białe tło, czarny tekst, ukryte interaktywne.
- `folio export <id> --format pdf` używa Puppeteera, drukuje z `@media print`.

---

## Dostępność

- Kontrast WCAG AA (sprawdzić color vars).
- `aria-label` na ikonkach (gdy będą).
- `prefers-color-scheme` szanowane gdy `data-theme="auto"`.
- Klawiaturowa nawigacja w viewerze.
