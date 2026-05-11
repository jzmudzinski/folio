# Sumi (wabi-sabi observation) example

**User prompt:**

> Zapisz mi krótką refleksję po tygodniu pracy z Folio — co się zmieniło w sposobie myślenia, nic długiego, sumi vibes

**Agent decision:**

- Reflective + short + „sumi vibes" → **theme: sumi**, type: `snippet`
- Voice: meditative, observational, low-volume
- Structure: short paragraphs, single thread of thought, brak konkretnych „findings"
- AVOID: scorecards, comparisons, lists with bullets

**Action:**

1. `folio.suggest_thread({ title: "Refleksje" })` → use `refleksje` or `weekly-observations`
2. `folio.create({ type: "snippet", title: "Tydzień z Folio", theme: "sumi", thread_id: "weekly-observations", body_html: <see output.html> })`
