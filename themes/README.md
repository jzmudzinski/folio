# Folio themes — convention notes

## Flexible width pattern (v2)

Pain point from the brief: "every theme capped content width too aggressively." The fix shipped in 10 new themes (atlas / studio / memo / codex / ledger / sumi / arcade / garden / kraft / prism):

**Two widths instead of one.**

```css
:root {
  --wrap-max: clamp(720px, 92vw, 1180px);   /* outer chrome — wide */
  --read-max: 66ch;                          /* prose column — narrow */
}

.wrap, main {
  max-width: var(--wrap-max);
  margin: 0 auto;
}

/* Prose elements (left-aligned, narrow) */
.wrap > p, .wrap > ul, .wrap > ol,
.wrap > h1, .wrap > h2, .wrap > h3,
.wrap > .lead, .wrap > blockquote,
.wrap > .eyebrow { max-width: var(--read-max); }

/* Break-out elements (full wrap) */
/* tables, pre, .cards, .verdict, hr, figure — 100% by default */
```

Effect: on a 1440px screen the chrome breathes, tables and cards fill the full width, but the prose column stays at an ergonomic 60-72ch. No more "tiny page in the middle".

Each theme picks its own `--read-max` to match the vibe:
- Sumi: 60ch (airy, slow read)
- Codex: 62ch (manuscript narrow)
- Studio / Garden / Kraft / Prism: 64ch (standard reading)
- Atlas / Memo / Arcade: 68-70ch (data-friendly)
- Ledger: 72ch (numbers-heavy)

`--wrap-max` uses `clamp(MIN, VW, MAX)` — scales responsively from mobile to desktop without media queries. Top values:
- Ledger: 1320px (widest, 5+ column tables)
- Studio: 1240px
- Prism: 1280px
- Atlas / Arcade / Garden / Kraft: 1160-1180px
- Memo: 1100px (memo feels more "paper" than display)
- Sumi / Codex: 1080-1100px (classical, deliberately narrow)

**Migration for the older 8 themes:** add `--read-max` to `:root`, add the `.wrap > *` selectors above, you can keep the existing `--wrap-max` or widen it to `clamp(...)`. The utility-class contract does not change.

## Theme list (after v2)

| Theme | Vibe | Best for |
|---|---|---|
| `linen` ⭐ default | Warm cream + orange + Familjen Grotesk | Public reports, polished docs |
| `folio` (noir) | Dark inverse of Linen | Dev-targeted, ADR, system specs |
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

## Utility-class contract (reminder)

Every theme must style these consistently:
- `.eyebrow` — caps label above H1
- `.lead`, `p.sub` — large/italic subtitle under H1
- `.pill` + `.good`/`.bad`/`.mid`/`.acc`/`.info` — inline badges
- `.card`, `.cards` — content grouping (cards = grid container)
- `.verdict` — closing recommendation

Plus base selectors: `html`, `body`, `.wrap/main`, `a`, `h1-h3`, `p`, `ul`/`ol`/`li`, `strong`/`em`, `code`/`pre`, `table`/`th`/`td`, `blockquote`, `hr`, `mark`, `footer`.

Full stylebook: `skills/folio/STYLEBOOK.md`.
