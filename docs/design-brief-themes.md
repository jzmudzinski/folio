# Folio Themes — Design / Generation Brief

> Brief dla Claude Design / agenta generującego theme'y na podstawie dostarczonej paczki materiałów (moodboard, design refs, brand inputs).
>
> Cały codebase Folio jest w kontekście — wszystkie ścieżki względne do repo root.

---

## TL;DR

Folio ma 8 starter themes. Potrzebuję nowych theme'ów wygenerowanych na bazie paczki materiałów którą zaraz dostaniesz. Każdy theme = folder w `themes/<name>/` z dwoma plikami (`theme.css` + `theme.md`). Wymóg: zachowanie kontraktu utility classes (`.eyebrow`, `.lead`, `.pill`, `.card`, `.cards`, `.verdict` itd.) — bez tego agenty piszące treści przez Skill stracą spójność.

---

## Co to Folio (kontekst w 1 paragrafie)

Folio = warstwa wizualnej komunikacji między AI agentami a człowiekiem. Agenty generują HTML notatki (research, comparison, technical), ląduje to w `~/Folio/threads/<topic>/<slug>.html`, user otwiera w lokalnym viewerze. **Theme** dyktuje jak wizualnie renderuje się treść — agent wybiera theme zgodnie z kontekstem (formal → newsroom, dev → terminal, casual → notebook). Pełny pivot i strategia: `docs/planning/Folio.md`.

---

## Anatomia theme'u w Folio

Każdy theme to **folder** w `themes/<name>/` z dwoma plikami:

### 1. `theme.css` — visual baseline

Musi definiować:

**CSS Variables (`:root`):**
```css
:root {
  --bg: #....;            /* main background */
  --bg-2: #....;          /* secondary surface */
  --panel: #....;         /* cards / elevated */
  --panel-2: #....;       /* code blocks bg */
  --border: ....;         /* dividers */

  --text: #....;          /* primary text */
  --soft: #....;          /* secondary text */
  --muted: #....;         /* metadata, captions */
  --muted-light: #....;   /* tertiary */

  --accent: #....;        /* primary brand color */
  --accent-2: #....;      /* secondary */
  --accent-3: #....;      /* tertiary, rare */

  --good: #....;          /* success / final */
  --bad: #....;           /* error / deprecated */
  --mid: #....;           /* warning */

  --font-sans: ...;       /* body text */
  --font-head: ...;       /* headings */
  --font-serif: ...;      /* italic emphasis, optional */
  --font-mono: ...;       /* code, metadata */

  --leading: 1.6;         /* line-height */
  --wrap-max: 880px;      /* content column max */
}
```

**Base selectors (must style all):**
- `html, body` — background, color, font, line-height
- `.wrap, main` — content wrapper with max-width
- `a, a:hover`
- `h1, h2, h3` — distinct visual hierarchy
- `p, ul, ol, li, li::marker`
- `strong, em`
- `code, pre, pre code`
- `table, th, td, thead, tbody`
- `blockquote`
- `hr`
- `mark`
- `footer`

**Utility classes (THE contract — must work):**
- `.eyebrow` — small uppercase label above h1
- `.lead`, `p.sub` — large muted/italic subtitle
- `.pill` + variants `.good`, `.bad`, `.mid`, `.acc`, `.info` — inline badges
- `.card`, `.cards` — content grouping (cards = grid container)
- `.verdict` — strong conclusion / recommendation callout

Bez nich agent generujący treść przez Skill (`skills/folio/STYLEBOOK.md`) traci spójność wizualną.

### 2. `theme.md` — prompt addendum dla agenta

Markdown z opisem voice/structure/typography/avoid/best-for. Skill wstrzykuje to do system prompta przed generowaniem `body_html` — żeby agent dostosował strukturę markup'u i ton do estetyki theme'u (np. Brutalist = krótkie zdania ALL CAPS, Newsroom = prose-forward, Notebook = first-person hedging).

Template `theme.md`:
```markdown
# Theme: <Name>

<Krótki opis estetyki — 1-2 zdania.>

## Voice
<Jak agent pisze: ton, perspektywa, slownictwo.>

## Structure
<Jakie patterny strukturalne preferowane: prose vs bullets, length, headings.>

## Typography
<Fonty z theme.css, kiedy serif/mono.>

## Klasy z theme.css
<Wymień główne classes + kiedy używać.>

## Avoid
<Czego NIE robić — antypatterny dla tego theme'u.>

## Best for
<Kiedy ten theme = właściwy wybór. Konkretne use case'y.>
```

---

## Co już mamy (NIE duplikuj)

8 starter themes w `themes/`:

| Theme | Wibe (skrót) |
|---|---|
| `linen` ⭐ default | warm cream + orange + Familjen Grotesk + serif italic lead |
| `folio` (noir) | dark inverse Linen, same DNA |
| `newsroom` | Source Serif Pro + off-white paper + red accent |
| `notebook` | Caveat handwritten + ruled-line bg + blue ink |
| `brutalist` | Helvetica 900 ALL CAPS + 6px drop shadows + black borders |
| `terminal` | JetBrains Mono everywhere + green-on-black + `# ##` markers |
| `pastel` | Plus Jakarta Sans + peach cream + soft accents |
| `dossier` | Courier Prime + manila + CONFIDENTIAL stamp |

**Pełny rendered gallery:** `docs/mockup-themes.html` — otwórz w przeglądarce, porównaj wszystkie 8 obok siebie.
**Live A/B w real content:** `http://127.0.0.1:4810/t/theme-gallery-demo` — ten sam demo content w każdym themie.

Nie rób kolejnego dark+purple albo kolejnego warm-cream-z-orange. Cel: rozszerzenie palette estetycznej, nie powielanie.

---

## Brand DNA — co MOŻESZ ruszyć, czego nie

**Wolno:**
- Dowolny background (light/dark/cream/colored)
- Dowolne fonty z Google Fonts CDN
- Dowolne accent colors
- Dowolne dekoracje (linie, stamps, badges, gradients, textures)
- Dowolne wrap-max widths (od ~600 do ~1100px sensible)

**NIE WOLNO:**
- Łamać kontrakt utility classes (zawsze muszą być stylowane spójnie semantycznie)
- Używać JS dla stylingu (CSS only)
- Linkować nic poza Google Fonts CDN
- Robić theme tak ciemnego/jasnego że accessibility (WCAG AA contrast) jest zerowa

**Wordmark / app chrome:** to oddzielna sprawa, NIE projektujesz tego tutaj. Theme dotyczy renderowania `<article>` content per nota, nie viewer'a aplikacji.

---

## Test content (ten sam dla każdego theme)

Demo notatka żeby porównać visual:

```html
<span class="eyebrow">Demo · Theme preview</span>
<h1>Próbka tematyczna</h1>
<p class="lead">Krótki kawałek treści żeby zobaczyć jak ten theme się prezentuje. Lead, sekcje, tabela, lista, verdict.</p>

<h3>Co tu testujemy</h3>
<p>Trzy rzeczy: <strong>typografia headerów</strong>, <em>akcent kolorystyczny</em> i <code>monospace inline</code>. Plus bullety:</p>
<ul>
  <li>Pierwszy punkt — coś krótkiego</li>
  <li>Drugi punkt — coś średniej długości żeby zobaczyć jak się zawija</li>
  <li>Trzeci punkt z <code>code</code></li>
</ul>

<h3>Tabela porównawcza</h3>
<table>
<thead><tr><th>Cecha</th><th>A</th><th>B</th></tr></thead>
<tbody>
<tr><td>Speed</td><td><span class="pill good">fast</span></td><td><span class="pill mid">ok</span></td></tr>
<tr><td>Cost</td><td>$5</td><td>$12</td></tr>
</tbody>
</table>

<h3>Cytat</h3>
<blockquote>"Best theme is the one user actually uses." — anon</blockquote>

<div class="verdict">
<h3>Werdykt</h3>
<p>Każdy theme nadaje się do czegoś innego. Wybór = decyzja produktowa.</p>
</div>
```

To samo będzie pushed jako nota w każdym themie do `theme-gallery-demo`, możesz wizualnie porównać z istniejącymi 8.

---

## Input materials (paczka od usera)

User dostarczy materiały referencyjne: moodboard, design refs, color inspirations, font pairings, vibe descriptions. Czytaj je uważnie — twoja praca to **translate** te referencje w działający Folio theme zgodny z kontraktem powyżej, NIE skopiować pixel-perfect 1:1.

Każdy theme ma mieć **wyraźny charakter** — jeśli paczka zawiera 3 moodboardy, masz wygenerować 3 osobne themes. Jeśli paczka jest dla jednego mood'a, jeden theme.

---

## Deliverables

Per theme, w `themes/<name>/`:

1. **`theme.css`** — kompletny CSS file z wszystkimi sekcjami z anatomii powyżej. Self-contained, działa standalone gdy linkowany przez viewer w `<head>`. Zaczyna od `@import url('https://fonts.googleapis.com/...')` jeśli używa Google Fonts.

2. **`theme.md`** — prompt addendum zgodnie z templatem powyżej. Krótko, konkretnie, ~50-100 linii max.

Po twoim wygenerowaniu, ja zrobię:
- `bun bin/folio.ts new --title "Demo: <theme> theme" --theme <theme> --thread theme-gallery-demo --html @demo.html`
- Renderowanie pojawi się w `http://127.0.0.1:4810/t/theme-gallery-demo` obok 8 obecnych
- Zobaczę visual A/B i dam feedback

---

## Naming convention

Theme name = folder name = single word, lowercase, ascii, no hyphens. Examples that work: `aurora`, `concrete`, `ledger`, `museum`, `lichen`. Examples that don't: `dark-mode`, `My Theme`, `1980s`.

Jeśli paczka sugeruje nazwę, użyj jej (zlowercase). Jeśli nie, wybierz słowo które oddaje vibe.

---

## Iteration loop

Wrzucasz theme(y) → ja generuję demo notę → daję feedback per theme w threadzie `theme-design-v1` (Folio note) → ty iterujesz.

```
folio.create({
  type: "technical",
  title: "Theme design questions — <theme name>",
  thread_id: "theme-design-v1",
  theme: "newsroom",
  body_html: "<h3>...</h3>"
})
```

---

## Reference reading

- `docs/wordmark-v05.html` — wordmark variations (nie projektujesz wordmark, ale rozumiesz brand DNA)
- `themes/linen/theme.css` + `themes/linen/theme.md` — najbardziej reprezentatywny istniejący theme do skopiowania jako template strukturalny
- `themes/brutalist/theme.css` — pokazuje że można jechać daleko od defaultu zachowując kontrakt
- `skills/folio/STYLEBOOK.md` — co agent obiecuje używać w body_html (czyli co theme musi obsłużyć)
- `docs/mockup-themes.html` — wszystkie 8 obok siebie z prompt addenda

---

## Success criteria

Wiem że dobrze wyszło jeśli:

- Theme nie jest podobny estetycznie do żadnego z 8 istniejących
- Demo content renderuje się estetycznie w każdej sekcji (eyebrow, h1, lead, h3, p, ul, table, blockquote, verdict, pills)
- Theme ma jasny "best for" use case który nie nakłada się z istniejącymi
- `theme.md` daje agentowi konkretne instrukcje — voice/structure/avoid są actionable
- Po podstawieniu nowego theme do `~/Folio/themes/<name>/`, viewer (`folio serve`) pickup'uje go bez restart
