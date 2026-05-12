# Research example

**User prompt:**

> Prepare research on RAG vs fine-tuning for a small SaaS in 2026

**Agent action sequence:**

1. `suggest_thread({ title: "RAG vs Fine-Tuning" })` → empty → use proposed `rag-vs-fine-tuning`
2. `create({ type: "research", title: "RAG vs Fine-Tuning for SaaS", body_html: <see output.html>, thread_id: "rag-vs-fine-tuning", tags: ["ai","rag","fine-tuning","saas"] })`
3. Respond to the user with `MEDIA:<public_url>` + a 3-5 line TL;DR.
