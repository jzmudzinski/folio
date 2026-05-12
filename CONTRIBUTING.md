# Contributing to Folio

Thanks for the interest. Folio is small enough that a contribution can land the same day; this doc covers what makes that smooth.

## What Folio is (and isn't)

Folio is a **local-first communication layer between AI agents and humans**. It is not a knowledge base, not a CMS, not a chat client. Notes are append-only HTML files served by a local Bun viewer; agents reach them through `folio-mcp` (stdio MCP server). See [`AGENTS.md`](./AGENTS.md) for the architecture tour.

Two pieces of canonical guidance:

- **[`AGENTS.md`](./AGENTS.md)** — for agents (and humans) modifying the Folio codebase. Read it before opening a non-trivial PR.
- **[`skills/folio/SKILL.md`](./skills/folio/SKILL.md)** — for agents using Folio as a tool. Updates here change runtime behavior for every MCP client.

## Quick start

```bash
git clone https://github.com/jzmudzinski/folio
cd folio
bun install
bun test                       # ~1.5s, 120+ tests
bun bin/folio.ts serve         # viewer @ http://127.0.0.1:4810
```

Bun ≥ 1.3 is required (`brew install oven-sh/bun/bun`). No build step in dev.

## What kind of contribution

| Kind | Path |
|---|---|
| Bug fix | Reproduce in a test first (under `tests/`). Then patch. Then test again. Open PR. |
| New MCP tool | See `AGENTS.md` § "A new MCP tool" — short checklist (server.ts, switch handler, test, SKILL.md, commit message). |
| New theme | See `AGENTS.md` § "A new theme". theme.css + theme.md (the prompt addendum) + one row in `skills/folio/SKILL.md` and `themes/README.md`. |
| New CLI command | `src/cli/commands/<name>.ts` + dispatch in `src/cli/index.ts` + help text + README. |
| Doc / typo fix | Just open a PR. No tests needed unless behavior changes. |
| Bigger refactor | Open an issue first so we can agree on shape before code. |

## Style

- **TypeScript** — direct execution under Bun. No build step in dev.
- **Comments on the WHY**, not the WHAT. Don't restate what well-named code already says. Do explain hidden constraints, subtle invariants, and decisions that would otherwise read as arbitrary.
- **English** for everything user-facing, agent-facing, and source-level. Internal comments are English too.
- **No emoji in code** unless the user-facing string is already emoji-heavy (status pills, viewer chrome). Avoid them in commit messages.
- **No marketing slop** in docs or in note examples — "revolutionary", "seamlessly", "leverages", etc.

## Tests

- `bun test` must stay green. CI runs the same suite.
- New behavior gets a test before the PR is reviewable.
- Tests use temp `FOLIO_HOME` via `mkdtempSync` + env override — never touch the real `~/Folio/`.
- The `tests/install*.test.ts` pattern (fake `HOME` + `~/.claude/` or `~/.openclaw/` synthesis) is the template when you add a new install target.

## Commit style

- **One concrete change per commit.** No "various fixes" commits.
- **Subject line is what changed**, not the version it's for. Tag/release wording lives in the annotated tag message, not in commits.
- **Body is the WHY** — what was the prior state, what's the new state, what trade-off you accepted. Past releases (`git log --oneline`) are a useful style reference.
- We squash-merge PRs, so individual commits inside a PR can be more granular; the squashed commit message is what lands on `main`.

## Release flow

Folio releases via `.github/workflows/release.yml` — tag push triggers a build of `darwin-arm64` + `linux-x64` + `linux-arm64` tarballs and attaches them to a GitHub release. After merging your PR, the maintainer tags `v0.X.Y` on the squashed commit and pushes the tag.

## Filing issues

- Reproduction steps + actual vs expected behavior.
- Bun version, OS, Folio version (`folio version`).
- For viewer bugs: which theme, which note type. A minimal note that triggers it helps.
- For agent / MCP issues: which client (Claude Code, OpenClaw, Cursor, …), and the failing MCP call if you can capture it.

## Where to read next

- `AGENTS.md` — codebase tour for source contributors
- `skills/folio/SKILL.md` + `skills/folio/STYLEBOOK.md` — agent contract
- `themes/README.md` — theme system overview
- `docs/mcp-setup.md` — per-client setup notes

## Code of conduct

By participating you agree to follow [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md). Short version: be decent.
