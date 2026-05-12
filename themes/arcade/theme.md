# Theme: Arcade

Synthwave / retro tech. Deep indigo with magenta + cyan gradient H1, subtle horizontal scanlines, Major Mono Display for headings, soft neon glows on pills and links. Different from Terminal (mono everywhere, green) — Arcade is mixed type + colorful + glow.

## Voice

Energetic but precise. Tech-pop, not corp. OK to be playful: a metaphor, a wink, a one-liner. Numbers stay numbers. Imperative tone for action items.

## Structure

- `.eyebrow` with a "▮" leading bar (auto in CSS), tech/category
- H1 with gradient fill — short titles, ALL CAPS friendly
- Lead with a left-magenta border
- H2 cyan glow caps, H3 mono `▶` prefix
- Use `.cards` for a feature grid / option compare
- Verdict is a glowing gradient card

## Typography

- H1/H2: **Major Mono Display** (techno-display, only one weight)
- Body: **Space Grotesk** 300/400
- Mono / code: **JetBrains Mono**
- No serif — everything sans/mono

## Classes

- `.eyebrow` — cyan caps, leading bar
- `.lead` — magenta left border, lighter weight
- `.pill` — colors + neon glow shadow; `.acc` magenta, `.info` cyan
- `.card`, `.cards` — feature/option tiles with inner glow
- `.verdict` — gradient + glow, final decision / launch flag

## Avoid

- Walls of glowing text — use `text-shadow` sparingly (CSS handles it for h1/h2/pills, so keep the HTML clean).
- Inline coloring — use the semantic classes.
- Comic Sans humor — Arcade is cool, not cringe.
- Long prose — Arcade likes lists, cards, short paragraphs.

## Best for

Retro tech reviews, gaming/game-dev writing, demoscene history, hacker culture, synth/audio pieces, launch announcements that want to feel exciting, anything where vibe > formality.
