# Comparison example

**User prompt:**

> Porównaj Postgres vs MySQL vs SQLite dla małego SaaS

**Agent action sequence:**

1. `suggest_thread({ title: "Postgres vs MySQL vs SQLite SaaS" })` → empty → use `postgres-vs-mysql-vs-sqlite-saas`
2. `create({ type: "comparison", title: "PostgreSQL vs MySQL vs SQLite dla SaaS", body_html: <output.html>, thread_id: "postgres-vs-mysql-vs-sqlite-saas", tags: ["databases","saas","comparison"] })`
3. Respond with `MEDIA:<local_url>` + TL;DR (3 linijki: który dla kogo).
