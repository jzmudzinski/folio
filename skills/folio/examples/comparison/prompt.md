# Comparison example

**User prompt:**

> Compare Postgres vs MySQL vs SQLite for a small SaaS

**Agent action sequence:**

1. `suggest_thread({ title: "Postgres vs MySQL vs SQLite SaaS" })` → empty → use `postgres-vs-mysql-vs-sqlite-saas`
2. `create({ type: "comparison", title: "PostgreSQL vs MySQL vs SQLite for SaaS", body_html: <output.html>, thread_id: "postgres-vs-mysql-vs-sqlite-saas", tags: ["databases","saas","comparison"] })`
3. Respond with `MEDIA:<public_url>` + a TL;DR (3 lines: which one for whom).
