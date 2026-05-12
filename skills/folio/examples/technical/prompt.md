# Technical (ADR) example

**User prompt:**

> Write me an ADR: why we choose Bun over Node for Folio

**Agent action sequence:**

1. `suggest_thread({ title: "ADR Bun Node Folio" })` → empty → `adr-bun-node-folio`
2. `create({ type: "technical", title: "ADR-001: Bun over Node", body_html: <output.html>, thread_id: "adr-bun-node-folio", theme: "folio", tags: ["adr","bun","node","runtime"] })`
   - Theme override: `folio` (dev-targeted, code-heavy fits better than linen)
3. Respond with `MEDIA:<public_url>` + a 3-line TL;DR: decision, why, main tradeoff.
