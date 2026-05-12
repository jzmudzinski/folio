# Sumi (wabi-sabi observation) example

**User prompt:**

> Write me a short reflection after a week of working with Folio — what changed in how I think, nothing long, sumi vibes

**Agent decision:**

- Reflective + short + "sumi vibes" → **theme: sumi**, type: `snippet`
- Voice: meditative, observational, low-volume
- Structure: short paragraphs, single thread of thought, no concrete "findings"
- AVOID: scorecards, comparisons, lists with bullets

**Action:**

1. `suggest_thread({ title: "Reflections" })` → use `reflections` or `weekly-observations`
2. `create({ type: "snippet", title: "A week with Folio", theme: "sumi", thread_id: "weekly-observations", body_html: <see output.html> })`
