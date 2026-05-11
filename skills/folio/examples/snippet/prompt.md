# Snippet example

**User prompt:**

> Zapisz to: SQLite FTS5 z `unicode61 remove_diacritics 2` dobrze działa dla polskiego — "swieze" matchuje "świeże"

**Agent action sequence:**

1. `folio.suggest_thread({ title: "SQLite FTS5 polski tokenizer" })` → empty → `sqlite-fts5-polski-tokenizer`
2. `folio.create({ type: "snippet", title: "SQLite FTS5 + polskie diakrytyki", body_html: <output.html>, thread_id: "sqlite-fts5-polski-tokenizer", tags: ["sqlite","fts5","polski","tokenizer"] })`
3. Respond with `MEDIA:<local_url>` + 1-line confirmation.
