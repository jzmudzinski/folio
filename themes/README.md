# Folio themes — convention notes

## Flexible width pattern (v2)

Pain point z brief'u: "wszystkie theme ograniczały szerokość contentu". Rozwiązanie wprowadzone w 10 nowych theme'ach (atlas / studio / memo / codex / ledger / sumi / arcade / garden / kraft / prism):

**Dwie szerokości zamiast jednej.**

```css
:root {
  --wrap-max: clamp(720px, 92vw, 1180px);   /* outer chrome — szeroki */
  --read-max: 66ch;                          /* prose column — wąski */
}

.wrap, main {
  max-width: var(--wrap-max);
  margin: 0 auto;
}

/* Prose elements (lewo-wyrównane, narrow) */
.wrap > p, .wrap > ul, .wrap > ol,
.wrap > h1, .wrap > h2, .wrap > h3,
.wrap > .lead, .wrap > blockquote,
.wrap > .eyebrow { max-width: var(--read-max); }

/* Break-out elements (full wrap) */
/* tables, pre, .cards, .verdict, hr, figure — domyślnie 100% */
```

Efekt: na 1440px ekranie chrome dyszy, tabele i karty wypełniają całą szerokość, ale prose column zostaje w ergonomicznym 60-72ch. Nie ma "uciętej kartki pośrodku".

Każdy theme dobiera własne `--read-max` zgodnie z vibe:
- Sumi: 60ch (oddychający, slow read)
- Codex: 62ch (manuscript narrow)
- Studio / Garden / Kraft / Prism: 64ch (standard reading)
- Atlas / Memo / Arcade: 68-70ch (data-friendly)
- Ledger: 72ch (numbers-heavy)

`--wrap-max` jest `clamp(MIN, VW, MAX)` — responsywnie skaluje się od mobile do desktop bez media queries. Top wartości:
- Ledger: 1320px (najszerszy, tabele 5+ kolumn)
- Studio: 1240px
- Prism: 1280px
- Atlas / Arcade / Garden / Kraft: 1160-1180px
- Memo: 1100px (memo to bardziej "papier" niż display)
- Sumi / Codex: 1080-1100px (klasyczne, zwężone z premedytacji)

**Migration dla starych 8 theme'ów:** dodaj `--read-max` do `:root`, dodaj selektory `.wrap > *` powyżej, możesz zostawić obecne `--wrap-max` albo zwiększyć do `clamp(...)`. Kontrakt utility classes nie zmienia się.

## Lista theme'ów (po v2)

| Theme | Wibe | Best for |
|---|---|---|
| `linen` ⭐ default | Warm cream + orange + Familjen Grotesk | Public reports, polished docs |
| `folio` (noir) | Dark inverse Linen | Dev-targeted, ADR, system specs |
| `newsroom` | Source Serif Pro + red | Long-form, formal reports |
| `notebook` | Caveat handwritten + ruled bg | Brainstorm, journal |
| `brutalist` | Helvetica 900 ALL CAPS | Manifesto, hot takes |
| `terminal` | Mono everywhere, green-on-black | Log analysis, debugging |
| `pastel` | Plus Jakarta + peach/sage | Gentle communication |
| `dossier` | Courier + manila stamp | OSINT, investigation |
| **`atlas`** ✨ | Crimson Pro + small caps + dropcap | Scientific papers, research |
| **`studio`** ✨ | Fraunces display + huge numerals | Design crit, case study |
| **`memo`** ✨ | IBM Plex Sans + § markers | Decision docs, business memos |
| **`codex`** ✨ | UnifrakturCook + EB Garamond + rubric | Treatises, philosophy, long essays |
| **`ledger`** ✨ | IBM Plex Mono + tabular nums + ruled bg | Financial reports, KPI reviews |
| **`sumi`** ✨ | Cormorant + Klee One + vermillion seal | Wabi-sabi, slow reads, observation |
| **`arcade`** ✨ | Major Mono + magenta/cyan glow | Retro tech, demoscene, launch |
| **`garden`** ✨ | Cormorant italic + sage + ❀ | Nature writing, gentle research |
| **`kraft`** ✨ | Bricolage + risograph duotone | DIY zines, indie hot takes |
| **`prism`** ✨ | Space Grotesk + Newsreader italic | Editorial features, opinion essays |

## Kontrakt utility classes (przypomnienie)

Każdy theme musi stylować spójnie:
- `.eyebrow` — caps label nad H1
- `.lead`, `p.sub` — duży/italic subtitle pod H1
- `.pill` + `.good`/`.bad`/`.mid`/`.acc`/`.info` — inline badges
- `.card`, `.cards` — content grouping (cards = grid container)
- `.verdict` — closing recommendation

Plus base selectors: `html`, `body`, `.wrap/main`, `a`, `h1-h3`, `p`, `ul`/`ol`/`li`, `strong`/`em`, `code`/`pre`, `table`/`th`/`td`, `blockquote`, `hr`, `mark`, `footer`.

Pełny stylebook: `skills/folio/STYLEBOOK.md`.
