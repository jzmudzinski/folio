---
name: folio-event-watcher
description: "Surfaces new Folio events (iteration picks, variants, todo state changes, pins) into the agent's context on every user turn. Polls ~/Folio/threads/*/*.entries.jsonl since the last seen cursor; no daemon, no socket."
metadata:
  openclaw:
    emoji: "📚"
    events: ["message:received"]
    requires:
      bins: ["node"]
      env: []
    install:
      managed: true
---

# folio-event-watcher

OpenClaw hook that pulls fresh Folio events into the agent's context once per user message. Reference implementation of "Option A" from [`docs/openclaw-integration.md`](../../docs/openclaw-integration.md) in the Folio repo.

## What it does

On every `message:received`:

1. Reads `~/.openclaw/state/folio-cursors-<sessionKey>.json` — the per-session cursor file remembering the last entry id seen per Folio JSONL.
2. Scans every `*.entries.jsonl` under `$FOLIO_HOME/threads/` (defaults to `~/Folio/threads/`).
3. For each file, reads only entries that landed after the cursor.
4. Filters for events meaningful to surface — `kind:pick` and `kind:variant` (iteration), `state:done` and `view:pinned` (live notes). Other entries are noise; skipped.
5. If anything matched, `event.messages.push("Folio events since your last turn: …")` so the agent's next reply has them as context.
6. Writes the updated cursor back to the sidecar file.

## What it doesn't do

- Doesn't run between turns. If you need autonomous loops (agent acts on Folio events without the user typing), see Option B in [`docs/openclaw-integration.md`](../../docs/openclaw-integration.md) — bridge daemon + webhook. Tracked for v0.22+.
- Doesn't subscribe to remote Folio clouds. Local JSONL only. Cross-machine reads come later when OpenClaw's webhook URL pattern stabilizes.
- Doesn't filter by tag yet. Every project's events surface to every agent session. Per-project filtering is a future enhancement.

## Customization

The defaults match common workflows; for more aggressive or quieter signal, edit `handler.ts` directly — it's small (~80 lines) and the filter list is right at the top.

- **Default match list**: tag predicates `kind:pick`, `kind:variant`, `state:done`, `view:pinned`.
- **Default cap**: 20 events surfaced per turn (to bound context size in busy sessions).
- **Default lookback when cursor missing**: latest 5 events (so the first turn after install isn't a flood).

## Installed by `folio install --target openclaw`

If you ran `folio install --target openclaw`, this hook is already at `~/.openclaw/hooks/folio-event-watcher/` (symlinked from the Folio install root). To remove: `folio uninstall --target openclaw`.

Manual install (if you didn't run `folio install`):

```bash
ln -s /path/to/folio/hooks/openclaw/folio-event-watcher ~/.openclaw/hooks/folio-event-watcher
openclaw hooks enable folio-event-watcher
```
