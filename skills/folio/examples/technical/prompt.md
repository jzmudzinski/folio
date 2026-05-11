# Technical (ADR) example

**User prompt:**

> Zrób mi ADR: dlaczego wybieramy Bun zamiast Node dla Folio

**Agent action sequence:**

1. `folio.suggest_thread({ title: "ADR Bun Node Folio" })` → empty → `adr-bun-node-folio`
2. `folio.create({ type: "technical", title: "ADR-001: Bun zamiast Node", body_html: <output.html>, thread_id: "adr-bun-node-folio", theme: "folio", tags: ["adr","bun","node","runtime"] })`
   - Theme override: `folio` (dev-targeted, code-heavy fits better than linen)
3. Respond with `MEDIA:<local_url>` + 3-line TL;DR: decyzja, dlaczego, główny tradeoff.
