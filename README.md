# Folio

> Visual communication layer between AI agents and humans.
> Markdown isn't enough. Folio = standalone HTML as the medium for current conversation with an agent. **Not a knowledge base — communication.**

## Quick start

```bash
# 1. Bootstrap
bun bin/folio.ts init

# 2. Create a note (HTML fragment, no <html>/<body> needed)
bun bin/folio.ts new \
  --title "RAG vs Fine-Tuning" \
  --type research \
  --thread rag-vs-finetuning \
  --tags "ai,rag" \
  --html @sample.html

# 3. Browse
bun bin/folio.ts serve
# → http://127.0.0.1:4810
```

## Commands

| Command | What |
|---|---|
| `folio init` | Bootstrap `~/Folio/` (or `$FOLIO_HOME`) |
| `folio new --title T --type X --html @file.html` | Create note |
| `folio list [--type X] [--thread T] [--final] [--limit N] [--json]` | List recent |
| `folio search "query" [--type X] [--json]` | FTS5 full-text search |
| `folio finalize <id>` | Mark as final (skip auto-cleanup) |
| `folio stats` | Counts + analytics |
| `folio serve` | Local viewer on `:4810` |

`FOLIO_HOME=/path` overrides storage root. `FOLIO_DEBUG=1` for stack traces.

## Status (2026-05-11)

- **S0** ✓ Repo + Bun + MCP SDK validated on Bun
- **S1** ✓ Storage (SQLite + FTS5) + viewer + analytics
- **S2** ✓ Templates (`_base`, `research`) + themes (Linen default, Folio) + render profiles
- **S3** ⬜ MCP server
- **S4** ⬜ OpenClaw Skill
- **S5** ⬜ Lifespan + cleanup daemon
- **S6** ⬜ Cloud publish (folio.app)
- **S7** ⬜ Polish + mobile

## Concepts

- **Append-only** (ADR-014) — agents only CREATE, never edit. New version = new document in same thread folder.
- **Threads** — related notes live in `~/Folio/threads/<thread_id>/`.
- **Final marker** — opt-in via UI/CLI/MCP. Non-final notes auto-delete after 30 days (ADR-015). Publish auto-finalizes.
- **Themes** (ADR-020) — folder per theme: `theme.css` + `theme.md` (prompt addendum). Bundled: `linen` (default), `folio`. Drop your own in `~/Folio/themes/<name>/`.
- **Render profiles** (ADR-012) — `hosted` (links theme.css, -50% tokens) vs `standalone` (inline, share-ready).
- **Analytics** (ADR-017) — every action logs to `events` table. `folio stats` shows class-match rate (validates token claim).

## Design references

The HTML mockups in `docs/` are *both* design specs and reference notes for the agent to learn from (S4 STYLEBOOK):

- `docs/plan-dzialania.html` — strategy + roadmap
- `docs/plan-implementacji.html` — ADRs, sprints, blockers, risks
- `docs/mockup-viewer.html` — 4 viewer states (browse / search / thread / note)
- `docs/mockup-themes.html` — 8 starter themes side-by-side
