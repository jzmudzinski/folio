# Folio Stylebook — kontrakt z theme.css

> Klasy utility wspólne dla wszystkich theme'ów (linen/folio/newsroom/notebook/brutalist/linen/terminal/pastel/dossier). Każdy theme implementuje je we własnej estetyce, ale **strukturalna semantyka jest spójna**.

## Co generujesz

**Fragment HTML do `<article>`** — bez `<html>`, `<head>`, `<body>`, `<style>`, `<script>`, `<title>`, `<meta>`. Te są w template.

Zwykła struktura noty:

```html
<span class="eyebrow">Type · Subcategory</span>
<h1>Tytuł</h1>
<p class="lead">Lead 1-2 zdania ustanawiające stawkę.</p>

<h3>Sekcja</h3>
<p>Akapit.</p>

<ul>
  <li>Bullet 1</li>
  <li>Bullet 2</li>
</ul>

<!-- … -->

<div class="verdict">
  <h3>Werdykt</h3>
  <p>Konkluzja / rekomendacja.</p>
</div>
```

## Klasy utility

### `.eyebrow`
Mała, capsowana etykieta nad H1 — kategoria/typ.

```html
<span class="eyebrow">Research · AI / ML</span>
```

### `.lead`
Większy, "miękki" subtitle pod H1. 1-2 zdania.

```html
<p class="lead">Lead ustanawiający kontekst.</p>
```

### `.pill`
Inline status badge. Warianty: `.good` / `.bad` / `.mid` / `.acc` / `.info`.

```html
<span class="pill good">✓ done</span>
<span class="pill bad">deprecated</span>
<span class="pill mid">WIP</span>
<span class="pill acc">recommended</span>
<span class="pill info">tip</span>
```

### `.card`, `.cards`
Pojedyncza karta / grid kart. Karta to logiczna jednostka.

```html
<div class="cards">
  <div class="card">
    <h3>Card A</h3>
    <p>Krótki opis.</p>
  </div>
  <div class="card">
    <h3>Card B</h3>
    <p>Opis.</p>
  </div>
</div>
```

### `.verdict`
Konkluzja / rekomendacja — wyróżniony blok z lewym borderem akcentu.

```html
<div class="verdict">
  <h3>Werdykt</h3>
  <p>Krótka rekomendacja co wybrać.</p>
</div>
```

## Sekcje (h2 / h3)

- **`<h1>`** — tytuł noty (template generuje, czasem owinięty gradient w `.t-folio`)
- **`<h2>`** — duże sekcje (rzadko w research/comparison)
- **`<h3>`** — typowy heading sekcji ("TL;DR", "Kiedy X", "Werdykt")

W theme'ach `terminal` i `dossier` h3 dostaje prefiks markery przez CSS — pisz czystą semantykę, theme zadba o ozdoby.

## Tabele

```html
<table>
  <thead>
    <tr><th>Cecha</th><th>A</th><th>B</th></tr>
  </thead>
  <tbody>
    <tr><td>Cena</td><td>$5</td><td>$10</td></tr>
  </tbody>
</table>
```

Zawsze `<thead>` + `<tbody>`. Theme.css zadba o styling — nie pisz inline `border="1"`.

## Listy

```html
<ul>
  <li>Bullet point</li>
</ul>

<ol>
  <li>Numbered step</li>
</ol>
```

Bullet style zależy od theme'u (linen używa kropek, brutalist czerwonych strzałek, pastel `✿`, dossier `☐`). Pisz `<li>`, theme decyduje.

## Inline

- **`<strong>`** — emphasis tekstowy (theme czasem renderuje jaśniej, czasem grubszą czcionką)
- **`<em>`** — italics (w newsroom dostają specjalne traktowanie)
- **`<code>`** — inline code (mono font + tło)
- **`<mark>`** — highlight (theme.css daje subtle background)
- **`<a href="...">`** — link

## Code blocks

```html
<pre><code>function example() {
  return 42;
}</code></pre>
```

Theme.css formatuje. Brak inline `style="font-family:monospace"`.

## Blockquote

```html
<blockquote>
  "Cytat."
  <footer>— Źródło</footer>
</blockquote>
```

W theme'ach typu newsroom dostaje większy weight.

## Czego NIE robisz

❌ **Inline `style="..."`** — łamie spójność theme'ów. Wyjątki:
   - `style="width: 70%"` na div-progress bar (jeśli zaproponujesz)
   - `style="--accent: #abc"` jako custom property override
   - Nic więcej.

❌ **Hex colors w atrybutach** — używaj klas `.pill.good` zamiast `style="background:#34c759"`

❌ **`<style>` w body_html** — to template's job (theme.css)

❌ **`<script>`** — sanitizer dropuje. Nie nawet komentowane.

❌ **`<font>`, `<center>`, `<u>`** — deprecated HTML4

❌ **`<div style="display:flex; gap:10px">`** — używaj `.cards` jeśli to grid kart, albo zostaw natural flow

❌ **Generowanie z marketing tone'em** — „revolutionary", „cutting-edge", „seamlessly", „leverages"

## Tone — per theme

Theme.md w `~/Projects/Folio/themes/<name>/theme.md` ma sekcję "Voice" i "Avoid" — przeczytaj **aktualnego theme'u prompt addendum** zanim generujesz. `folio.list_themes` zwraca pełny `prompt_addendum` field.

**Linen (default):** clear, measured, public-facing. Generous whitespace.
**Folio:** precise, opinionated, snarky OK. Numbers > vague.
**Newsroom:** journalistic, balanced, prose-forward.
**Notebook:** personal, exploratory, hedging OK.
**Brutalist:** direct, no hedging, short sentences.
**Terminal:** log-entry tone, imperatives, code-aggressive.
**Pastel:** warm, encouraging, gentle.
**Dossier:** investigative, factual, third-person.

## Mierzymy (ADR-017)

Każde użycie `folio.create` zapisuje do `events`:
- `class_count` — ile klas użyłeś z theme.css
- `inline_style_count` — ile `style="..."` (cel: 0)
- `sanitizer_drops` — ile sanitizer wyrzucił (cel: 0, znaczy nie ma exotic shit)

`folio stats` pokazuje `class_match_rate` — % klas vs random styling. Cel ADR-012: ≥ 60%.

Jeśli widzisz `inline_style_count > 0` często — refaktor stylebooka lub uściślaj prompt usera (ktoś próbuje generować coś, czego template nie obsługuje natywnie).
