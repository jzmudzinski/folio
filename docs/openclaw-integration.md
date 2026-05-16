# OpenClaw integration

How Folio's events reach an OpenClaw-hosted agent — and how `folio install --target openclaw` automates wiring it up.

## Problem

`wait_for_pick` (v0.19.1) closes the synchronous gap inside one agent tool-call cycle. The agent calls `wait_for_pick`, blocks on Folio's SSE hub, gets the variant_id when the user clicks. Clean. But it only works while the agent is *in a tool call*. The moment the agent finishes its turn and the gateway goes idle, no more `wait_for_pick` — `EventSource` connections live in the agent process and die when the call returns.

Three workflow shapes lose out:

1. **Autonomous iteration loop without human-in-loop.** Agent proposes round 1, ends its turn, goes idle. User picks a variant minutes/hours later. Without something on the OpenClaw side to wake the agent, the user has to type a message ("zrobione, co dalej?") to trigger the next propose_round. Friction.
2. **Cross-note attention surface.** User has 6 active Folio projects. While they're working in chat A, project B's iteration round 3 gets picked, project C's finalize fires. The agent never knows unless the user mentions it.
3. **Long-running design partner mode.** Agent stays subscribed to a few specific notes across days. Reacts to events as they happen. Folio events on its own host.

None of these need new Folio capabilities — the SSE stream + JSONL substrate already emit every event we'd want. They need an OpenClaw-side bridge that *brings* those events into the agent's context.

## Folio event surfaces (already exist)

| Surface | Where | Shape | Best for |
|---|---|---|---|
| **`/n/:id/stream`** (SSE) | Local viewer HTTP | `event: entry` frames with full LiveEntry JSON | Real-time push; agent / bridge subscribes long-running |
| **`~/Folio/threads/*/*.entries.jsonl`** | Filesystem | Append-only NDJSON, one entry per line | Polling; fault-tolerant; safe to read while writing |
| **`MCP wait_for_pick`** | MCP stdio | Synchronous tool call, blocks until pick or timeout | Agent itself, inside one tool-call cycle |
| **`MCP iteration_state`** | MCP stdio | Snapshot read | Catch-up after restart |

Files are the lowest common denominator — anything can `tail -F` them with no auth. SSE is the same data via HTTP for cross-process or cross-host setups. MCP tools are agent-only.

## Three integration architectures

### Option A — Polling-on-message hook (chosen for v0.21.0 reference impl)

OpenClaw hook subscribes to `message:received`. On every user message, the hook:

1. Reads its per-session cursor file (last-seen entry id per note JSONL)
2. Scans `~/Folio/threads/*/*.entries.jsonl` — for each file, reads new lines past the cursor
3. Filters meaningful events (`kind:pick`, `kind:variant`, `state:done`, `view:pinned` — configurable)
4. If any new events, `event.messages.push("Folio events since your last turn: …")` — surfaces them into the agent's context for this turn
5. Updates cursor to the latest seen entry id per note

```
┌─────────────┐
│ User types  │
└──────┬──────┘
       │ message:received
       ▼
┌─────────────────────────────────────┐
│ folio-event-watcher hook            │
│  1. Read cursor sidecar             │
│  2. Diff JSONL tails                │
│  3. Filter relevant entries         │
│  4. event.messages.push(summary)    │
│  5. Write cursor sidecar            │
└──────┬──────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│ Agent receives message + Folio      │
│ event summary as system context     │
└─────────────────────────────────────┘
```

**Pros:**
- Zero daemons to manage — runs in-process inside OpenClaw's hook executor
- Filesystem-native — works whether Folio viewer is running or not
- Bounded execution — completes in tens of milliseconds (stat + read-append)
- Resilient to OpenClaw restarts (cursor persists on disk)

**Cons:**
- Not autonomous — agent only sees Folio events when the user types
- Sub-second freshness loss between event landing on disk and agent's next turn (acceptable for most workflows)

### Option B — Bridge daemon + webhook

A separate long-running process (`folio bridge --webhook <url>`) subscribes to SSE (or tails JSONL), and POSTs events to OpenClaw's webhook endpoint as they land. OpenClaw routes the webhook to a handler that wakes the agent or queues a follow-up turn.

Needed for **autonomous loops between turns** — agent acts without the user typing.

Blockers in v0.21.0:
- OpenClaw's webhook URL pattern isn't documented at time of writing (see `/automation/cron-jobs#webhooks` — only mentioned, no spec).
- Running a daemon requires a service supervisor (systemd, launchd, runit, or a tmux session) — more friction than the v0.21.0 release should ship without strong demand.

Deferred to v0.22+. The reference impl in this release leaves an extension point: the same cursor/filter logic in Option A can be invoked from a bridge daemon with no structural change.

### Option C — Hybrid

Option A as the default (every user surfaces accumulated events), plus Option B opt-in for projects where between-turn autonomy matters. Each enabled per-note or per-project via a tag (e.g. `agent:autonomous`).

Future. Not v0.21.0.

## Reference implementation — `folio-event-watcher` hook

Ships in repo at `hooks/openclaw/folio-event-watcher/`:

- **`HOOK.md`** — frontmatter declares `events: ["message:received"]`, requires `node` and the `FOLIO_HOME` env (defaults to `~/Folio`).
- **`handler.ts`** — async function implementing the polling logic. Reads JSONL files, filters entries, pushes summary to `event.messages`.

State persistence (per design):
- Folio doesn't get OpenClaw session state hooks — uses sidecar JSON at `~/.openclaw/state/folio-cursors-<sessionKey>.json`
- Shape: `{ [jsonl_path]: <last_entry_id> }`
- Created on first invocation; reset by deleting the file

Filtering policy (defaults, configurable per hook config):
- `kind:variant` → "Round N proposed in <note title> with N variants" (auto-refresh signal)
- `kind:pick` → "User picked variant <label> on round N in <note title>"
- `state:done` → "Item <title> marked done in <note title>"
- `view:pinned` → "<title> pinned to top in <note title>"
- Other entries skipped to avoid context bloat.

## `folio install --target openclaw` automation

The existing install command symlinks the SKILL and registers the MCP server in `~/.openclaw/openclaw.json`. v0.21.0 extends it with:

1. **Symlink the hook** — `hooks/openclaw/folio-event-watcher/` → `~/.openclaw/hooks/folio-event-watcher/`
2. **Enable the hook** — add `hooks.internal.entries.folio-event-watcher.enabled = true` to `~/.openclaw/config.json` (creates the file if missing, patches the relevant key without touching other entries — same JSON merge logic used for MCP)
3. **Skip if no openclaw** — same precondition gating as the existing MCP wiring

`folio uninstall --target openclaw` reverses both. `folio doctor --target openclaw` reports hook state alongside SKILL + MCP.

## Trade-offs that drove these choices

- **Why polling vs SSE for the hook itself?** SSE inside a `handler.ts` would need to maintain a persistent connection. OpenClaw documents handlers as bounded reactive functions — heavy async should fire-and-forget via background processes. Polling JSONL on each `message:received` is bounded, fast, and doesn't keep a socket open between invocations.
- **Why JSONL not the SSE endpoint?** Local viewer might not be running. Filesystem is the source of truth Folio writes to first; SSE is derived. Polling JSONL works even if `folio serve` is down.
- **Why `message:received` not `command:new`?** `command:new` fires on slash-commands the user types. `message:received` fires on every user message — the natural cadence for "what's new since last time I spoke". For pure chat workflows the difference is academic but `message:received` is more general.
- **Why sidecar cursor not OpenClaw session state?** OpenClaw docs don't expose a typed key-value store for hooks. Filesystem sidecar is portable, debuggable (just `cat` the JSON), and survives OpenClaw upgrades that might rearrange internal state schemas.

## Future work

- **Option B (bridge daemon)** when OpenClaw webhook URL pattern stabilizes — `folio bridge --webhook <url>` subcommand + systemd/launchd unit shipped via `folio install --bridge`.
- **Per-project filters** — agents working on `project:repcoach-fit` shouldn't see events from `project:other-thing` unless they care. Hook reads tags and filters accordingly.
- **Cross-cloud bridging** — when notes sync to a Folio cloud, the bridge can subscribe to cloud SSE instead of local JSONL, letting an agent on machine A react to picks happening on machine B.
- **Reverse direction** — agent updates Folio in response to OpenClaw events (e.g. when user sends a screenshot in chat, hook attaches it as a Folio asset).
