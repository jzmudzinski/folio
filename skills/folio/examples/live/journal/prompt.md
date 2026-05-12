# Live journal example

**User prompt (initial, creates the live note):**

> Start a daily journal for me — I'll dump thoughts throughout the day, no structure required.

**Agent action sequence (creation):**

1. `suggest_thread({ title: "Daily journal 2026-05-12" })` → empty → use `daily-journal-2026-05-12`
2. `create({ type: "journal", title: "2026-05-12 — daily", body_html: "", thread_id: "daily-journal-2026-05-12", theme: "notebook", live: true, tags: ["daily", "journal"] })`
3. Respond with `MEDIA:<public_url>` + a 1-line confirmation. Note the response gains `stream_url` — the user can pop it open and watch entries arrive.

**Later in the day — user dumps a thought:**

> 🧠 finally figured out why the parser was choking on multi-line strings — it was eagerly consuming the closing quote when escaped

**Agent action:**

```
append_entry({
  note_id: <id>,
  content_html: "<p>Finally figured out why the parser was choking on multi-line strings — it was eagerly consuming the closing quote when escaped. Fix: track escape state in the tokenizer.</p>",
  tags: ["topic:parser-bug"]
})
```

No `state:*` — daily journal entries don't have lifecycle. The viewer chrome posts the entry into the feed panel; user sees it appear immediately.

**Why this pattern (vs a regular note):**
- ✅ Multi-session — user comes back at 4pm, agent appends again to the same note
- ✅ Chronological by default — viewer orders by ts
- ✅ Finalize at end of day → the day's journal becomes a regular static note, joins the archive
