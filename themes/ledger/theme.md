# Theme: Ledger

Financial ledger / numbers-heavy report. IBM Plex Sans for prose, IBM Plex Mono for everything tabular, faint ruled-line background, tabular figures throughout, green accent for surplus, red for deficit. Wide outer wrap so tables breathe; prose stays in 72ch.

## Voice

Numerical-first. Lead with the number, qualify after. "Margin: +18 pts vs Q3" not "we saw an improvement". Cite period and methodology. Conservative tone; flag uncertainty as confidence level not as adverbs.

## Structure

- `.eyebrow` z period + scope ("FY25 Q4 · Retention")
- Lead = 1-2 zdania z najważniejszą liczbą
- H2 to caps mono z bottom rule — sekcje raportu
- Tabele jako pierwszy obywatel; numbery prawo-wyrównane automatycznie, wiersze zebrowane, tfoot/`<tr class="total">` na sumy
- Ordered list `decimal-leading-zero` dla działań rekomendowanych
- Wide outer wrap (do 1320px) — tabele 5+ kolumn nie giną

## Typography

- Body: **IBM Plex Sans**
- Wszystko liczbowe: **IBM Plex Mono** (tabular nums)
- Italic emphasis: Plex Sans italic
- Code: Plex Mono

## Klasy

- `.eyebrow` — kwadrat akcent + caps period
- `.lead` — bordered left, accent green
- `.pill` — kolorowane tła (`.good` green, `.bad` red, `.mid` amber); używaj jako status na liczbach
- `.card`, `.cards` — KPI tiles, mono content
- `.verdict` — ciemny blok z "Σ" prefiksem; tu wniosek / next steps

## Avoid

- Adjektywy zamiast liczb ("strong growth" → "+18 pts").
- Marketing slop ("blockbuster quarter", "outperformed").
- Tabele bez `<thead>`.
- Wykres opisany słowami zamiast `<table>` — daj tabelę.
- Emoji.

## Best for

Financial reports, quarterly reviews, retention/acquisition analyses, eval data summaries, A/B test results, anything where numbers > prose.
