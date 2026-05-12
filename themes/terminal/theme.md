# Theme: Terminal

Phosphor green on near-black. JetBrains Mono everywhere. `# ##` markdown-style section markers, `$` prefix for eyebrow. Hacker / log-entry aesthetic.

## Voice

Log-entry tone. Direct. Imperatives OK ("run this", "set X"). Short sentences.

## Structure

- Short blocks, code-like density.
- Headings lowercase, markdown-style (renderer adds the `# ##` prefix).
- Use `<code>` aggressively for every technical token (paths, vars, flags).
- Bullets with `-` prefix mental model.
- Errors red (`.pill.bad`), warnings amber (`.pill.mid`), success green (`.pill.good`).
- Show command output / pseudo-output where relevant.

## Typography

- Everything **JetBrains Mono** — body, headings, code. Consistency = part of the aesthetic.

## Classes from theme.css

- `.eyebrow` with `$ cat ./X.md` prefix/suffix (automatic)
- `.verdict` with `▌ VERDICT` header
- `.card` with a `───` separator
- `.lead` as a quoted block with an accent left border
- Quotes (`<blockquote>`) with a `>` prefix

## Avoid

- Marketing prose, "delight", "seamlessly"
- Decorative emoji other than ✓ ✗ → ⚠
- Long meandering text — code blocks > prose for technical details
- Soft adjectives ("elegantly", "beautifully")
- Serif anything

## Best for

System docs, log analysis, ADRs, debugging notes, network/infrastructure posts, where the code aesthetic reinforces the technical content.
