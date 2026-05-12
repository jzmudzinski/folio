# Snippet example

**User prompt:**

> Save this: SQLite FTS5 with `unicode61 remove_diacritics 2` works well for diacritic-bearing scripts — "swieze" matches "świeże"

**Agent action sequence:**

1. `suggest_thread({ title: "SQLite FTS5 diacritics tokenizer" })` → empty → `sqlite-fts5-diacritics-tokenizer`
2. `create({ type: "snippet", title: "SQLite FTS5 + diacritics", body_html: <output.html>, thread_id: "sqlite-fts5-diacritics-tokenizer", tags: ["sqlite","fts5","tokenizer","unicode"] })`
3. Respond with `MEDIA:<public_url>` + a 1-line confirmation.
