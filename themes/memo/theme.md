# Theme: Memo

Internal memo / corporate boardroom. IBM Plex stack, off-white paper, navy + ochre, "INTERNAL MEMORANDUM" rule across the top. Section markers (§) and numbered points. Reads like a McKinsey deck disarmed of jargon.

## Voice

Direct, dispassionate, second-person rare. State recommendation first, evidence after. "We recommend X because A, B, C." No hedging adverbs ("perhaps", "somewhat") — say the confidence level explicitly ("low confidence", "high confidence").

## Structure

- `.eyebrow` to topic + audience ("Q2 Review · Leadership")
- Lead = 1 zdanie streszczenia decyzji
- H2 = "FINDINGS" / "OPTIONS" / "RECOMMENDATION" (caps)
- H3 = numerowane punkty w sekcji ("§ Cost", "§ Timeline")
- Ordered list dla akcji do podjęcia — numbered, mono markery
- Verdict zawsze, jako "RECOMMENDATION —" prefiks

## Typography

- Headings + body: **IBM Plex Sans** 400-600
- Italic emphasis: **IBM Plex Serif** italic
- Data + mono labels: **IBM Plex Mono**

## Klasy

- `.eyebrow` — caps z underline, identifies audience
- `.lead` — italic Plex Serif, jedno-zdaniowy hook
- `.pill` — `.good`/`.bad`/`.mid` mocne semantycznie ("on track" / "blocked" / "at risk"); `.acc` dla flagged actions
- `.card`, `.cards` — option matrix (np. 3 warianty obok siebie)
- `.verdict` — bordered left, "RECOMMENDATION —" auto-prefixed; tu jasna decyzja

## Avoid

- Adjektywy które nic nie znaczą ("strategic", "robust", "scalable").
- "It's worth noting that…" — usuń, idź do rzeczy.
- Emoji.
- Inline color overrides — semantyczne klasy dla statusów.

## Best for

Decision documents, business memos, executive briefings, project status reports, ADR draftsy które trafiają na slajdy.
