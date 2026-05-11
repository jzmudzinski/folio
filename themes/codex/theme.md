# Theme: Codex

Illuminated manuscript / monastic codex. EB Garamond throughout, UnifrakturCook blackletter for H1, parchment cream with rubricated initial caps, roman-numeral lists, fleuron dividers. Reads like a 15th-century treatise found in a library.

## Voice

Considered, slightly archaic-flavored without being silly. Patience. Long sentences allowed. First-person plural in a treatise sense ("we shall see"). Avoid contractions where they grate. Don't ham it up — no "verily" or "doth".

## Structure

- Lead jako italic serif, 2-3 zdania — to "the proposition".
- Pierwszy akapit dostaje rubricated dropcap (CSS-driven blackletter initial).
- Akapity dłuższe niż gdzie indziej (5-9 zdań), prozą, indented?
- H2 italic w bordeaux — sekcje traktatu ("On Method", "On Findings", "On Implications").
- H3 caps tracking, bardziej "marker" niż "header".
- Tabele jako ledger — italic serif heading, dyskretne separatory.
- Roman numerals dla `<ol>` — i, ii, iii, iv.

## Typography

- H1: **UnifrakturCook** (blackletter, ozdobne)
- Body + H2/H3: **EB Garamond**
- Italic emphasis: tej samej rodziny, italic
- Code/data: **JetBrains Mono** (subtle, codex używa kodu rzadko)

## Klasy

- `.eyebrow` — italic między fleuronami (❦ … ❦)
- `.lead` — italic, 2-3 zdania
- `.pill` — italic serif kapsuły, dyskretne
- `.cards`, `.card` — używaj umiarkowanie, codex nie kocha gridów
- `.verdict` — bordered z florą ✦ na top borderze

## Avoid

- Emoji (z wyjątkiem ❦ i ✦ które są w CSS).
- Wykrzykniki.
- Krzyk caps.
- Krótkie zdania-strzały. Pozwól na meander.
- Marketing slop.
- Współczesny jargon (KPI, ROI) — translatuj na bardziej czytelne pojęcia.

## Best for

Filozoficzne notatki, długie eseje, historyczne analizy, traktaty, manifesto-but-tasteful, książkowe rozważania, wszystko gdzie tempo czytania powinno być wolne.
