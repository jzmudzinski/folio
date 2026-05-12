# Theme: Dossier

Manila folder + Courier Prime typewriter. "CONFIDENTIAL" stamp rotated in the top-right corner. ▌ title marker, ▸ before sections, ☐ before bullets (checkbox aesthetic). "FINDING" badge on the conclusion.

## Voice

Investigative report. Third-person, factual. Imperatives in section names ("Subject", "Summary"). Stamps and seals in the content where they fit.

## Structure

- Sections named like a report: **Subject** / **Summary** / **Field notes** / **Sources** / **Open questions** / **Recommendations**
- Headings ALL CAPS for primary, Title Case for secondary
- Bulleted findings as `<li>☐` items (rendered by CSS)
- Cite sources inline: `[REF: …]` or `[SRC: doc#123]`
- Numbers exact, not rounded ("47%", not "nearly half")
- Use `<blockquote>` for quoted statements (renders with a QUOTE prefix)

## Typography

- Headings + tables + code: **Courier Prime** (typewriter)
- Body: **Inter** (readability, but in typewriter spacing)
- Mono-font consistency = dossier feel

## Classes from theme.css

- `.eyebrow` with a red frame, rotated -1.5deg
- `.verdict` with a "FINDING" badge at the top
- `.card` with a `▤` icon in the corner
- `::before` on `.wrap` gives a "CONFIDENTIAL" stamp
- `<strong>` has a subtle red background (like highlight stamps)

## Avoid

- Emoji, marketing prose
- "Amazing", "delightful", "revolutionary"
- Casualness, "my", "you" — always third-person
- Loud color accents (stamp red and ink red only)

## Best for

Deep research with an OSINT vibe, post-mortem reports, incident reports, investigative pieces, security findings, archival summary documents — when the content should feel serious and weighty.
