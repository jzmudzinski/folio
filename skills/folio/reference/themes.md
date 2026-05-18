# Choosing `theme`

Default user-wide: usually **linen** (Apple-grade minimal). Override only when the context strongly fits a different theme's voice.

| Context | Theme |
|---|---|
| Public-facing report / customer-facing | `linen` |
| System design / ADR / code-heavy | `folio` |
| Long-form journalism, formal report | `newsroom` |
| Personal brainstorm, journal | `notebook` |
| Manifesto, polemic | `brutalist` |
| Log / debugging / system internals | `terminal` |
| Personal soft communication | `pastel` |
| OSINT, investigation, dossier | `dossier` |
| Scientific paper, academic | `atlas` |
| Design crit, case study | `studio` |
| Decision doc, business memo | `memo` |
| Treatise, philosophy, long essay | `codex` |
| Financial report, KPI review | `ledger` |
| Wabi-sabi observation | `sumi` |
| Retro tech, demoscene | `arcade` |
| Nature writing | `garden` |
| DIY zine, indie hot take | `kraft` |
| Editorial feature, opinion essay | `prism` |
| Custom layout / poster / ASCII art / experimental | `plain` — bare canvas, agent owns the `<style>` block |

## Rules

- **Default if user didn't say.** Don't ask "what theme?" — pick.
- **Suggest override only when context strongly fits** ("make me an ADR" → `folio`; "build me a poster" → `plain`).
- **After picking:** `list_themes()` returns a `prompt_addendum` per theme. Read the relevant one before generating body — the theme dictates markup style (newsroom prose-forward, brutalist short sentences, atlas drop-cap opening, etc.).
- **`plain` is special:** sanitizer runs in permissive mode for plain (v0.21.3+), so the agent can ship full HTML5 — `<b>`, all attributes, custom CSS — without losing tags. Other themes keep the strict allowlist.
