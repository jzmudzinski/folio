# Journal example

**User prompt:**

> Write me a journal after today's chats with Marta — what we agreed, what's left open

**Agent action sequence:**

1. `suggest_thread({ title: "Daily journal" })` → an existing `daily-journal` thread probably matches; use it (or `daily` for short)
2. `create({ type: "journal", title: "Thursday — Marta calls", thread_id: "daily", theme: "notebook", tags: ["daily","meeting","marta"], body_html: <see output.html> })`
3. Respond with `MEDIA:<public_url>` + a 2-line recap.

**Why the notebook theme:**
- Personal, exploratory voice
- Handwritten headings fit a "what we talked about" register
- Hedging is OK ("seems to me…")

Skip notebook if the user wants a formal record-of-meeting — use `memo` instead.
