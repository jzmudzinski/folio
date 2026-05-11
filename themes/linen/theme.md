# Theme: Linen

Warm cream paper + orange accent. Familjen Grotesk dla nagłówków, Instrument Serif italic dla lead/cytatów, JetBrains Mono dla metadanych. **Default theme dla Folio — brand-aligned z wordmarkiem.**

Filozofia: editorial-meets-product. Calm, archival but living. Pomarańczowa kropka jako akcent (cytat z wordmark v08). Lead w italic serif działa jak miękki manifest.

## Voice

Clear, measured, confident — z miejscem na poetic moment przez italic serif lead. Public-facing tone — assume non-technical reader may open this on phone.

## Structure

- Lead jako 1-2 zdania w italic serif (Instrument Serif). To pierwszy oddech notatki, ustawia ton.
- Akapity dobrze rozłożone (3-5 zdań). Generous whitespace między sekcjami.
- Nagłówki krótkie (2-5 słów), descriptive, customer-readable.
- Bullety oszczędnie — proza dla niuansu, lista tylko dla konkretnych itemów.

## Typography (z theme.css)

- Headings: **Familjen Grotesk** (500 weight, tight tracking -0.03em)
- Body: **Inter** (system fallback)
- Italic emphasis + lead: **Instrument Serif** italic
- Code + metadata: **JetBrains Mono**

## Klasy do użycia

- `.eyebrow` — mono caps label nad h1 ("Research · AI / ML")
- `.lead` / `p.sub` — italic serif subtitle (zamiast plain bold/large)
- `.pill` (`.good`, `.bad`, `.mid`, `.acc`, `.info`) — inline status
- `.card`, `.cards` — content grouping
- `.verdict` — konkluzja z orange left-border

## Avoid

- Emoji storm. Subtle ✓ ✗ ◆ akceptowalne.
- Tech jargon bez definicji.
- Wykrzykniki (!).
- Hex colors w atrybutach — używaj klas.
- Bombarding bullet-after-bullet — wstaw paragraf między.
- "Revolutionary", "cutting-edge", "seamlessly", "leverages" — marketing slop.

## Best for

Default dla wszystkiego co się publikuje albo share'uje. Public-facing reports, polished docs, customer-facing explanations, executive summaries. Pierwszy theme jaki user widzi.
