# Research example

**User prompt:**

> Przygotuj research na temat RAG vs fine-tuning dla małego SaaS w 2026

**Agent action sequence:**

1. `folio.suggest_thread({ title: "RAG vs Fine-Tuning" })` → empty → use proposed `rag-vs-fine-tuning`
2. `folio.create({ type: "research", title: "RAG vs Fine-Tuning dla SaaS", body_html: <see output.html>, thread_id: "rag-vs-fine-tuning", tags: ["ai","rag","fine-tuning","saas"] })`
3. Respond to user with `MEDIA:<local_url>` + 3-5 line TL;DR.
