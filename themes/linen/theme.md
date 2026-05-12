# Theme: Linen

Warm cream paper + orange accent. Familjen Grotesk for headings, Instrument Serif italic for leads/quotes, JetBrains Mono for metadata. **Default theme for Folio — brand-aligned with the wordmark.**

Philosophy: editorial-meets-product. Calm, archival but living. The orange dot is the brand accent (lifted from wordmark v08). The italic serif lead reads like a soft manifesto.

## Voice

Clear, measured, confident — with room for a poetic moment via the italic serif lead. Public-facing tone — assume a non-technical reader may open this on a phone.

## Structure

- Lead as 1-2 sentences in italic serif (Instrument Serif). This is the note's first breath; it sets the tone.
- Paragraphs well-spaced (3-5 sentences). Generous whitespace between sections.
- Headings short (2-5 words), descriptive, customer-readable.
- Bullets sparingly — prose for nuance, lists only for concrete items.

## Typography (from theme.css)

- Headings: **Familjen Grotesk** (500 weight, tight tracking -0.03em)
- Body: **Inter** (system fallback)
- Italic emphasis + lead: **Instrument Serif** italic
- Code + metadata: **JetBrains Mono**

## Classes to use

- `.eyebrow` — mono caps label above h1 ("Research · AI / ML")
- `.lead` / `p.sub` — italic serif subtitle (instead of plain bold/large)
- `.pill` (`.good`, `.bad`, `.mid`, `.acc`, `.info`) — inline status
- `.card`, `.cards` — content grouping
- `.verdict` — conclusion with orange left-border

## Avoid

- Emoji storm. Subtle ✓ ✗ ◆ are acceptable.
- Tech jargon without definition.
- Exclamation marks (!).
- Hex colors in attributes — use the classes.
- Bullet-after-bullet bombing — insert a paragraph between.
- "Revolutionary", "cutting-edge", "seamlessly", "leverages" — marketing slop.

## Best for

Default for anything you publish or share. Public-facing reports, polished docs, customer-facing explanations, executive summaries. The first theme a user sees.
