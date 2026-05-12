# Ledger (financial / KPI) example

**User prompt:**

> Make me a Q3 financial report — revenue per product line, costs, operating margin, in a table

**Agent decision:**

- Numbers-heavy + per-category breakdown + "report" → **theme: ledger** (IBM Plex Mono + tabular nums + wide read-max 72ch)
- Type: `technical` (it's a structured document, not narrative)
- Multiple tables, tabular alignment matters
- Add `pill.good`/`.bad`/`.mid` for trend indicators

**Action:**

1. `suggest_thread({ title: "Q3 finance" })` → use `q3-2026-finance` or new thread
2. `create({ type: "technical", title: "Q3 2026 — financial review", theme: "ledger", thread_id: "q3-2026-finance", tags: ["finance","q3-2026","kpi","review"], body_html: <see output.html> })`
