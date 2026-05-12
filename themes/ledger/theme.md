# Theme: Ledger

Financial ledger / numbers-heavy report. IBM Plex Sans for prose, IBM Plex Mono for everything tabular, faint ruled-line background, tabular figures throughout, green accent for surplus, red for deficit. Wide outer wrap so tables breathe; prose stays in 72ch.

## Voice

Numerical-first. Lead with the number, qualify after. "Margin: +18 pts vs Q3" not "we saw an improvement". Cite period and methodology. Conservative tone; flag uncertainty as a confidence level, not as adverbs.

## Structure

- `.eyebrow` with period + scope ("FY25 Q4 · Retention")
- Lead = 1-2 sentences with the most important number
- H2 caps mono with a bottom rule — report sections
- Tables as first-class citizens; numbers right-aligned automatically, rows zebra-striped, tfoot/`<tr class="total">` for totals
- Ordered list `decimal-leading-zero` for recommended actions
- Wide outer wrap (up to 1320px) — 5+ column tables stay legible

## Typography

- Body: **IBM Plex Sans**
- Anything numeric: **IBM Plex Mono** (tabular nums)
- Italic emphasis: Plex Sans italic
- Code: Plex Mono

## Classes

- `.eyebrow` — square accent + caps period
- `.lead` — bordered left, green accent
- `.pill` — colored backgrounds (`.good` green, `.bad` red, `.mid` amber); use as a status on numbers
- `.card`, `.cards` — KPI tiles, mono content
- `.verdict` — dark block with a "Σ" prefix; this is the conclusion / next steps

## Avoid

- Adjectives instead of numbers ("strong growth" → "+18 pts").
- Marketing slop ("blockbuster quarter", "outperformed").
- Tables without `<thead>`.
- A chart described in words instead of a `<table>` — give the table.
- Emoji.

## Best for

Financial reports, quarterly reviews, retention/acquisition analyses, eval data summaries, A/B test results — anything where numbers > prose.
