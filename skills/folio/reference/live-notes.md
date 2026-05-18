# Live notes (v0.9.0+)

## Contents
- When to use vs not
- Panel mode vs inline mode
- Tool surface
- Chain-of-entries (mutate via append)
- Tag conventions + Folio's two rendering opinions

---

Some notes grow over time — a journal that gets a new entry every morning, a todo list whose items change state, an ops feed an agent appends to all day. Create them with `live: true`. The note's body_html stays minimal (or empty) at create time; entries land in a sidecar `<slug>.entries.jsonl` via `append_entry`.

## Two render modes (v0.17+)

- **Panel mode** (default — `live: true`, `inline` omitted or false): entries render in a separate panel beside the body iframe. The body itself stays static. Best when the body is its own document and the feed is metadata about it (e.g. an ADR with running comments, a research note with live citations).
- **Inline mode** (`live: true, inline: true`): entries render INSIDE body_html on every viewer hit, plus new entries arrive in real time via parent→iframe postMessage. **No side panel.** Best when the document IS the feed — daily journal, todo list, ops log, capture target. The body grows as you append.

The viewer chrome streams entries via SSE; for inline notes the chrome forwards each entry into the body iframe's `<section data-folio-live-feed>` placeholder. When the user (or you, when explicitly asked) calls `finalize`, Folio compiles the feed into body_html permanently and the live behavior shuts off — note becomes indistinguishable from any other final note.

## When to use `live: true`

- ✅ Long-running observation (daily journal, weekly retro, project ops log) — usually `inline: true`
- ✅ Todo list / inbox / capture target — items appear, mutate, get resolved → `inline: true`
- ✅ Agent watches an external source and posts what arrives (CI, Slack, Linear, sensor data) → `inline: true`
- ✅ Multi-session context — append more entries hours/days later
- ✅ Long-form note that grows annotations / comments over time → panel mode (body stays the canonical document)

## When NOT to use

- ❌ One-off note (regular `create` is the right call)
- ❌ Anything that's already finished thinking — just write it as body_html

## Picking inline vs panel

- The document IS the feed (journal, todo, log, capture) → `inline: true`
- The document has its own structure and the feed is meta-commentary → panel mode (default)
- Default to `inline: true` for `type: "journal"` unless you have a reason not to.

## Inline body_html shape

Include a `<section data-folio-live-feed></section>` placeholder where you want entries to land. If you omit it, Folio appends one to the end of body. Around the placeholder, any static chrome — heading, lead paragraph, footer:

```html
<span class="eyebrow">Daily journal · 2026-05-14</span>
<h1>Today</h1>
<p class="lead">Tracking what mattered.</p>
<section data-folio-live-feed></section>
```

## Tool surface

```
create({ ..., live: true, inline?: boolean })  → returns stream_url + local_stream_url
append_entry({ note_id, content_html, tags, refs?, importance?, source_ref? })
list_entries({ note_id, since?, tag?, limit? })  → for context resume
set_pinned({ note_id, entry_ids[] })  → ≤ 5; full target list, diff is computed
finalize({ id })  → compiles entries into body_html, archives jsonl
```

## Chain-of-entries — how you "edit" tags

Entries are append-only. To change an entry's state, append a new entry that references it via `refs:[<entry-id>]` with the new tags. Folio compiles tag sets on read: namespaced tags (`ns:value`) use last-write-wins, non-namespaced tags accumulate.

```
# 1. Append a todo
append_entry({ note_id: N, content_html: "<p>Ship v0.9</p>", tags: ["state:open", "project:folio"] })
  → entry_id = "p02merb8na"

# 2. Append a follow-up that marks it done (the follow-up itself may
#    have content OR be empty — empty entries don't render but their
#    tags still compile onto the refs target).
append_entry({ note_id: N, content_html: "<p>Merged and tagged.</p>", tags: ["state:done"], refs: ["p02merb8na"] })
  → entry_id = "kq3z8rkfx2"

# 3. list_entries now shows entry p02merb8na with compiled_tags ["state:done", "project:folio"]
#    and state="done" — viewer renders it strikethrough.
```

## Tag conventions

Folio doesn't validate tag values at the schema level. It has **exactly two rendering opinions**:

| Namespace / tag | Folio renders | Meaning |
|---|---|---|
| `state:open` | default (no decoration) | not yet done |
| `state:done` | strikethrough + dimmed | completed |
| `state:cancelled` | dimmed (no strikethrough) | abandoned |
| `state:snoozed` | amber "snoozed" pill | deferred |
| `view:pinned` | pulled to "Worth noticing" rail at top of feed panel | high salience |

Everything else is convention space. Recommended namespaces:

- `priority:1` … `priority:5` (1 = highest)
- `source:slack` / `source:ci` / `source:linear` / etc. — origin of the data
- `project:<slug>` / `topic:<slug>` / `client:<slug>` — same convention as note-level tags
- `kind:bug` / `kind:idea` / `kind:question` — discriminator within a single note
- Free-form `#tag` style (no namespace) — accumulates, no override

Pick a namespace pack at the start of a thread and stick with it.

## `view:pinned` → use `set_pinned`, not raw appends

The `set_pinned` tool takes the COMPLETE target list of pinned entry ids (≤ 5), diffs against current pinned state, and appends the minimal pin/unpin entries to reach the target. Don't manually append `view:pinned` and `view:unpinned` chains unless you know exactly what you're doing.
