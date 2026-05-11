# Theme: Terminal

Phosphor green na near-black. JetBrains Mono wszędzie. `# ##` markdown-style markery sekcji, `$` prefix dla eyebrow. Hacker / log-entry aesthetic.

## Voice

Log-entry tone. Direct. Imperatives OK („run this", „set X"). Krótkie zdania.

## Structure

- Krótkie bloki, code-like density.
- Headings lowercase, markdown-style (renderer dodaje `# ##` prefix).
- Use `<code>` aggressively dla każdego technical tokena (paths, vars, flags).
- Bullety z `-` prefix mental model.
- Errors red (`.pill.bad`), warnings amber (`.pill.mid`), success green (`.pill.good`).
- Pokazuj command output / pseudo-output gdzie relevant.

## Typography

- Wszystko **JetBrains Mono** — body, headings, code. Spójność = część estetyki.

## Klasy z theme.css

- `.eyebrow` z `$ cat ./X.md` prefix/suffix (automatycznie)
- `.verdict` z `▌ VERDICT` header
- `.card` z `───` separator
- `.lead` jako quoted block z accent left border
- Cytaty (`<blockquote>`) z `>` prefix

## Avoid

- Marketing prose, „delight", „seamlessly"
- Decorative emoji oprócz ✓ ✗ → ⚠
- Long meandering text — code blocks > prose dla technicznych szczegółów
- Soft adjectives („elegancko", „pięknie")
- Serif anything

## Best for

System docs, log analysis, ADR-y, debugging notes, network/infrastructure posts, gdzie aesthetic kodu wzmacnia treść techniczną.
