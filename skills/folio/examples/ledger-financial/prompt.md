# Ledger (financial / KPI) example

**User prompt:**

> Zrób mi raport finansowy Q3 — przychody per linia produktu, koszty, marża operacyjna, w tabeli

**Agent decision:**

- Numbers-heavy + per-category breakdown + „raport" → **theme: ledger** (IBM Plex Mono + tabular nums + wide read-max 72ch)
- Type: `technical` (it's a structured document, not narrative)
- Multiple tables, tabular alignment matters
- Add `pill.good`/`.bad`/`.mid` for trend indicators

**Action:**

1. `suggest_thread({ title: "Q3 finanse" })` → use `q3-2026-finance` or new thread
2. `create({ type: "technical", title: "Q3 2026 — financial review", theme: "ledger", thread_id: "q3-2026-finance", tags: ["finance","q3-2026","kpi","review"], body_html: <see output.html> })`
