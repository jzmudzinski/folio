# Theme: Arcade

Synthwave / retro tech. Deep indigo with magenta + cyan gradient H1, subtle horizontal scanlines, Major Mono Display for headings, soft neon glows on pills and links. Different from Terminal (mono everywhere, green) — Arcade is mixed type + colorful + glow.

## Voice

Energetic but precise. Tech-pop, not corp. OK to be playful: a metaphor, a wink, a one-liner. Numbers stay numbers. Imperative tone for action items.

## Structure

- `.eyebrow` z "▮" leading bar (auto in CSS), tech/category
- H1 z gradient fill — krótkie tytuły, ALL CAPS friendly
- Lead z left-magenta border
- H2 cyan glow caps, H3 mono `▶` prefix
- Use `.cards` dla feature grid / option compare
- Verdict to glowing gradient card

## Typography

- H1/H2: **Major Mono Display** (techno-display, only one weight)
- Body: **Space Grotesk** 300/400
- Mono / code: **JetBrains Mono**
- Brak serifu — wszystko sans/mono

## Klasy

- `.eyebrow` — cyan caps, leading bar
- `.lead` — magenta left border, lighter weight
- `.pill` — kolory + neon glow shadow; `.acc` magenta, `.info` cyan
- `.card`, `.cards` — feature/option tiles z inner glow
- `.verdict` — gradient + glow, finalna decyzja / launch flag

## Avoid

- Walls of glowing text — używaj glow `text-shadow` umiarkowanie (CSS robi to dla h1/h2/pills, więc HTML czysty).
- Inline kolorowanie — klasy semantyczne.
- Comic Sans humor — Arcade jest cool, nie cringe.
- Long prose — Arcade lubi listy, karty, krótkie akapity.

## Best for

Retro tech reviews, gaming/game-dev pisma, demoscene historia, hacker culture, pisma o synth/audio, launch announcements które chcą czuć się ekscytujące, anything where vibe > formality.
