# Live todo example

**User prompt (initial):**

> Open a todo list for the v0.9 release — I'll add items, you mutate state as I tell you.

**Agent action sequence (creation):**

1. `suggest_thread({ title: "v0.9 release todos" })` → empty → `v0-9-release-todos`
2. `create({ type: "journal", title: "v0.9 release todos", body_html: "", thread_id: "v0-9-release-todos", theme: "memo", live: true, tags: ["release", "v0.9"] })`
3. Respond with `MEDIA:<public_url>` + ready prompt.

**Adding items:**

```
append_entry({
  note_id: <id>,
  content_html: "<p>Write the ADR-020 doc</p>",
  tags: ["state:open", "priority:1"]
})
→ entry_id "a1b2c3d4e5"

append_entry({
  note_id: <id>,
  content_html: "<p>Update SKILL.md and STYLEBOOK.md</p>",
  tags: ["state:open", "priority:2"]
})
→ entry_id "f9g8h7i6j5"
```

**User marks one done (chain-of-entries):**

User: "ADR doc is shipped"

```
append_entry({
  note_id: <id>,
  content_html: "<p>Merged in #19, included in v0.9.0 commit body.</p>",
  tags: ["state:done"],
  refs: ["a1b2c3d4e5"]
})
```

The compile rule: entry `a1b2c3d4e5` now has `state:done` in its compiled tag set (last-write-wins on the `state:` namespace). Viewer renders it strikethrough with reduced opacity. The follow-up itself shows as a normal entry below, giving context.

**Pinning top items:**

```
set_pinned({
  note_id: <id>,
  entry_ids: ["f9g8h7i6j5"]
})
→ appends an entry with refs:["f9g8h7i6j5"], tags:["view:pinned"], content_html:""
```

The pinned entry now floats to the "Worth noticing" rail at the top of the feed.

**Why this pattern:**
- ✅ State machine over the entry, not over a separate field — preserves append-only
- ✅ Audit trail: every state change is its own entry with timestamp
- ✅ Pin/unpin without rewriting old entries
