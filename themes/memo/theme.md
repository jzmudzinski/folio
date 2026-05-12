# Theme: Memo

Internal memo / corporate boardroom. IBM Plex stack, off-white paper, navy + ochre, "INTERNAL MEMORANDUM" rule across the top. Section markers (§) and numbered points. Reads like a McKinsey deck disarmed of jargon.

## Voice

Direct, dispassionate, second-person rare. State the recommendation first, evidence after. "We recommend X because A, B, C." No hedging adverbs ("perhaps", "somewhat") — state the confidence level explicitly ("low confidence", "high confidence").

## Structure

- `.eyebrow` is topic + audience ("Q2 Review · Leadership")
- Lead = 1-sentence summary of the decision
- H2 = "FINDINGS" / "OPTIONS" / "RECOMMENDATION" (caps)
- H3 = numbered points within a section ("§ Cost", "§ Timeline")
- Ordered list for actions to take — numbered, mono markers
- Verdict always present, with a "RECOMMENDATION —" prefix

## Typography

- Headings + body: **IBM Plex Sans** 400-600
- Italic emphasis: **IBM Plex Serif** italic
- Data + mono labels: **IBM Plex Mono**

## Classes

- `.eyebrow` — caps with underline, identifies audience
- `.lead` — italic Plex Serif, one-sentence hook
- `.pill` — `.good`/`.bad`/`.mid` carry semantic weight ("on track" / "blocked" / "at risk"); `.acc` for flagged actions
- `.card`, `.cards` — option matrix (e.g. three variants side by side)
- `.verdict` — bordered left, "RECOMMENDATION —" auto-prefixed; this is the clear decision

## Avoid

- Adjectives that mean nothing ("strategic", "robust", "scalable").
- "It's worth noting that…" — remove, get to the point.
- Emoji.
- Inline color overrides — use semantic classes for status.

## Best for

Decision documents, business memos, executive briefings, project status reports, ADR drafts that end up as slides.
