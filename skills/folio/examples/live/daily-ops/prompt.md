# Live daily-ops example

**User setup:** An agent is configured to watch a CI feed, a few Slack channels via an MCP, and Linear (also via MCP). The user wants relevant updates collected into one Folio note throughout the day.

**Agent creates the daily ops note in the morning:**

1. `suggest_thread({ title: "Ops 2026-05-12" })` → empty → `ops-2026-05-12`
2. `create({ type: "journal", title: "Ops — Tuesday 2026-05-12", body_html: "", thread_id: "ops-2026-05-12", theme: "terminal", live: true, tags: ["ops", "daily"] })`

**Throughout the day — agent appends as events arrive from other MCPs:**

```
# CI failure
append_entry({
  note_id: <id>,
  content_html: "<p><code>folio</code> CI failed on PR #19 — <code>install.test.ts</code> flaked. Re-running.</p>",
  tags: ["source:ci", "kind:ci-fail", "project:folio"],
  source_ref: "https://github.com/jzmudzinski/folio/actions/runs/12345"
})

# Slack mention
append_entry({
  note_id: <id>,
  content_html: "<p>Marta in #folio-dev: asks whether <code>attach_asset</code> handles HEIC. (No — extension whitelist excludes it.)</p>",
  tags: ["source:slack", "kind:question", "project:folio", "needs-reply"],
  source_ref: "slack://channel?team=T0&id=C0&ts=1747000000.0"
})

# Linear ticket moved to In Review
append_entry({
  note_id: <id>,
  content_html: "<p>FOLIO-42 → In Review. v0.9 live notes primitive.</p>",
  tags: ["source:linear", "project:folio", "state:in-review"],
  source_ref: "https://linear.app/folio/issue/FOLIO-42"
})
```

**Tag namespaces in use here:**
- `source:*` — origin of the data (slack / ci / linear / sensor / …)
- `kind:*` — discriminator inside this note (ci-fail / question / decision / …)
- `project:*` — same convention as note-level tags, applied per-entry
- Plus the standard `state:*` for items that have lifecycle

The user opens the viewer mid-afternoon, sees the chronological feed in the chrome panel. They click the "source:slack" facet (auto-generated from compiled tags) to see only Slack-sourced entries. They append a manual note: "Going AFK 4-5pm" via `folio append` from CLI.

**End-of-day:** `finalize` compiles everything into a permanent ops journal in the archive.

**Why this pattern (vs separate notes per event):**
- ✅ One thread for the day, easy to scroll/skim
- ✅ Tags drive ad-hoc filtering — no schema needed for "show only Slack mentions"
- ✅ Agent doesn't need to decide upfront "is this a Slack event or a CI event"; tags carry it
