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

## Branch protection on `main`

`main` is protected: direct pushes are refused; changes flow through PRs. For a small project with one regular maintainer this is mostly self-discipline rather than review value (the maintainer reviews their own work either way). The intentional benefits we keep it for:

- **Forces the per-release `package.json` + CHANGELOG.md commit through CI** before it hits a tag. Catches the "I forgot to update version" footgun.
- **Generates a clean PR record per release** that doubles as a changelog entry visible to issue reporters.
- **Plays nicely with squash-merge convention** other open-source projects model — no special path for the maintainer.

If the friction stops being worth it, the call is to either (a) automate the release sequence further (a `scripts/release.sh` covering bump → PR → merge → tag → push), or (b) add a ruleset exception for `release-*` branches. We're leaving it as-is for now because the PR step has caught at least one accidental `git add -A` (the pnpm-lock.yaml that snuck into the cloud-mvp branch).

## Commit style

- **One concrete change per commit.** No "various fixes" commits.
- **Subject line is what changed**, not the version it's for. Tag/release wording lives in the annotated tag message, not in commits.
- **Body is the WHY** — what was the prior state, what's the new state, what trade-off you accepted. Past releases (`git log --oneline`) are a useful style reference.
- We squash-merge PRs, so individual commits inside a PR can be more granular; the squashed commit message is what lands on `main`.

## Release flow

Folio releases via `.github/workflows/release.yml` — tag push triggers a build of `darwin-arm64` + `linux-x64` + `linux-arm64` tarballs and attaches them to a GitHub release. The tag is annotated, points at a commit on `main`, and is pushed AFTER the merge — not before.

### Canonical sequence (maintainer)

```bash
# 1. Local: bump package.json + CHANGELOG.md entry, commit on main.
git checkout main
sed -i.bak 's/"version": ".*"/"version": "0.X.Y"/' package.json && rm package.json.bak
$EDITOR CHANGELOG.md
git add package.json CHANGELOG.md && git commit -m "chore: bump to v0.X.Y"

# 2. Push to a release branch (main is protected; direct push refused).
git push origin main:release-v0.X.Y

# 3. Open PR + merge + delete branch.
gh pr create --base main --head release-v0.X.Y --title "v0.X.Y: ..." --body "$(cat <<'EOF'
## Summary
...
EOF
)"
gh pr merge <number> --merge --delete-branch

# 4. Pull merged main locally, THEN tag (so tag points at a commit on main).
git fetch origin
git pull --ff-only origin main
git tag -a v0.X.Y -m "v0.X.Y: ..."
git push origin v0.X.Y

# 5. Wait for the release workflow + verify artifacts.
gh run watch                 # or: gh run list --limit 1
gh release view v0.X.Y       # confirms tar.gz triples uploaded
```

The order matters. Tag-before-merge (which v0.10.0 did) leaves the tag pointing at a commit that isn't part of main's first-parent history. `git describe --tags HEAD` won't return that tag from main. Functionally fine for `folio update` (the release artifact is what matters to users), but cosmetically off and breaks the convention every other tag in this repo follows.

### Pre-release checklist (maintainer)

Before tagging `v0.X.Y`, walk this list. Items 1–4 are non-negotiable; 5–7 are friction-reducers learned the hard way.

1. **Tests green** — both `bun test` (unit) and `bun run test:pwa` (Playwright headless browser).
2. **CHANGELOG.md** entry for the new version. Group by Added / Fixed / Removed. Note known scope cuts honestly.
3. **`folio doctor --offline`** on the dev machine shows no warnings other than the expected dev-vs-installed-path drift.
4. **`bun build --compile --target=bun-linux-x64 ./bin/folio.ts --outfile /tmp/x`** succeeds and the resulting binary's `folio version` matches the new tag.
5. **First-time-user walkthrough.** Pretend you've never used Folio. Walk through:
   - download release tarball → `./install.sh` → `folio init`
   - `folio new --title "Test" --type snippet --html-inline "<p>hi</p>"`
   - `folio serve` → open in browser → look at sidebar
   - `folio sync pair ...` against the dev cloud (see deploy/README.md "Test cloud changes locally")
   - Install PWA from local cloud → tap a note → tap a thread → search
   - `folio publish <id>` → open capability URL in incognito
   - `folio delete <id>` → verify sync propagates → verify PWA refreshes empty
   - `folio doctor` → all green
   Anywhere this trips: file an issue or fix before tag.
6. **README + docs in sync.** Any new CLI command in `src/cli/index.ts` should appear in the Commands table. Any new MCP tool in `src/mcp/server.ts` should appear in the Agent integration section.
7. **Schema migration** (if applicable). New column? Migration in `src/core/migrations.ts` `up()`, index in `PHASE2_SCHEMA` of `db.ts`. See the load-bearing rule in the migrations.ts header comment. Add an upgrade-path test in `tests/migrations.test.ts` that opens a byte-for-byte previous-version db.

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
