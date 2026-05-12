# Theme: Codex

Illuminated manuscript / monastic codex. EB Garamond throughout, UnifrakturCook blackletter for H1, parchment cream with rubricated initial caps, roman-numeral lists, fleuron dividers. Reads like a 15th-century treatise found in a library.

## Voice

Considered, slightly archaic-flavored without being silly. Patience. Long sentences allowed. First-person plural in a treatise sense ("we shall see"). Avoid contractions where they grate. Don't ham it up — no "verily" or "doth".

## Structure

- Lead as italic serif, 2-3 sentences — this is "the proposition".
- First paragraph gets a rubricated dropcap (CSS-driven blackletter initial).
- Paragraphs longer than elsewhere (5-9 sentences), in prose, indented?
- H2 italic in bordeaux — treatise sections ("On Method", "On Findings", "On Implications").
- H3 caps tracking, more "marker" than "header".
- Tables as ledger — italic serif heading, discreet separators.
- Roman numerals for `<ol>` — i, ii, iii, iv.

## Typography

- H1: **UnifrakturCook** (blackletter, ornamental)
- Body + H2/H3: **EB Garamond**
- Italic emphasis: same family, italic
- Code/data: **JetBrains Mono** (subtle — codex uses code rarely)

## Classes

- `.eyebrow` — italic between fleurons (❦ … ❦)
- `.lead` — italic, 2-3 sentences
- `.pill` — italic serif capsules, discreet
- `.cards`, `.card` — use sparingly; the codex doesn't love grids
- `.verdict` — bordered with a florid ✦ on the top border

## Avoid

- Emoji (except ❦ and ✦ which come from CSS).
- Exclamation marks.
- Caps shouting.
- Short arrow-sentences. Allow yourself to meander.
- Marketing slop.
- Modern jargon (KPI, ROI) — translate to more readable concepts.

## Best for

Philosophical notes, long essays, historical analyses, treatises, manifesto-but-tasteful, bookish reflections, anything where the reading pace should be slow.
