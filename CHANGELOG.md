# Changelog

All notable changes per release. The latest version is documented in [README.md](README.md). Older entries here for reference.

## v0.13.1 — 2026-05-14

Hotfix for v0.13.0's CLI dispatcher: top-level `parseArgs` consumed `--flag value` pairs into `flags` before dispatch, so `folio cloud pair-code --user alice` reached `cloudCmd` with no flags and errored with "--user required". Local tests passed because they called `cloudCmd` directly; only the actual binary invocation triggered it.

### Fixed
- **`folio cloud <sub> --flag …` now reaches the subcommand handler.** Dispatcher reconstructs `--flag value` and bare `--flag` pairs from `flags` and appends them to `cloudCmd`'s args. Affects every cloud subcommand that takes flags (`pair-code --user`, `user-add --display`, `user-list --json`, `user-revoke --purge --yes`). New regression test in `tests/cloud-user-cli.test.ts` drives through `main()` end-to-end.

## v0.13.0 — 2026-05-14

Multi-user cloud relay. One `folio.notibox.ai` instance now serves any number of independent users — each user pairs their Notibox + laptop + phone, and the cloud filters every read/write by user_id so accounts are invisible to each other. Cloud-side runtime changes — VPS deploys need `sudo ./deploy/update.sh`. Existing v0.12 paired devices keep working: the migration auto-runs and backfills to a single `default` user, which the operator can rename via the new CLI.

### Added
- **Multi-user partitioning across the cloud DB.** New `users` table; `user_id NOT NULL` column on devices / pairing_codes / notes / assets / tombstones / shares. Every authed query in `src/cloud/server.ts`, `sync.ts`, `shares.ts`, `stats.ts` now filters by `device.user_id` derived from the bearer. UNIQUE on notes flipped from `(thread_id, slug)` to `(user_id, thread_id, slug)` — Alice and Bob can both have a `morning` thread. Cross-user push/pull/raw/feed/admin-stats/share returns "not found" symmetrically (no leakage of uuid existence).
- **Idempotent v0.12 → v0.13 migrator** in `cloudDb()`. PRAGMA `table_info(devices)` canary detects pre-v0.13 schemas; `ALTER TABLE ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default'` fills every existing row in one statement; notes table rewritten under `PRAGMA foreign_keys = OFF` to swap the UNIQUE constraint without cascading the `note_tags` + `live_entries` FKs. Defensive: bails with a diagnostic if duplicate (user_id, thread_id, slug) groups would block the rebuild.
- **Per-user asset namespace.** New public route `GET /u/<user>/t/<thread>/asset/<file>` pins lookup to `assets.user_id`. `renderStandaloneNote` rewrites body_html refs `/t/<thread>/asset/<file>` → `/u/<user>/t/<thread>/asset/<file>` on serve so iframes always load the right user's bytes. Legacy `/t/<thread>/asset/<file>` route preserved for single-tenant compat — resolves only when exactly one user owns the (thread, filename) tuple, else 404. SW version bumped to `folio-pwa-7` to invalidate cached old-shape URLs.
- **CLI `folio cloud user-*`** (operator, server-side). Four new subcommands:
  - `folio cloud user-add <id> [--display "Name"]` — provision a new account. Kebab-case validation, idempotency, `--reactivate` flag for previously-deleted ids.
  - `folio cloud user-list [--json]` — per-user table: devices, notes, live entries, assets (count + bytes), shares, last seen. Operator's whole-cloud view, not exposed via HTTP.
  - `folio cloud user-rename <old> <new>` — atomic rename across all six user_id columns + the users row. Bearer tokens unaffected.
  - `folio cloud user-revoke <id> [--purge --yes]` — without flags, revokes all user's devices (data preserved). With `--purge --yes`, cascades delete on notes/assets/tombstones/shares + sets `users.deleted_at`. Confirmation gate requires explicit `--yes` to avoid accidental data loss.
- **`folio cloud pair-code --user <id>`** required when more than one user exists. Single-user installs keep the v0.12 invocation (no flag). Mints codes with `pairing_codes.user_id` set; consuming a code stamps the new device into that user's namespace.
- **Per-user `/v1/admin/stats`.** HTTP endpoint scoped to caller's user; Alice and Bob each see only their own counts. Operator CLI `user-list` retains the global view.

### Security
- **Cross-user push rejection.** `handlePush` ownership checks on every note/live_entry/delete: foreign-uuid pushes silently skipped (idempotent); cross-user live_entries fail the owner check; cross-user deletes log nothing and pass through unchanged. A leaked bearer can only damage its own user's data.
- **Capability URLs pinned to share.user_id.** Note/asset lookups behind `/p/<token>/...` join on `share.user_id` so a leaked token from user A can never resolve to user B's note even if a uuid collision is engineered.
- **`/v1/auth/devices` and `/v1/auth/device/:id` revocation** scoped to caller's user. Operator does cross-user revoke via the CLI, never via the API.

### Notes for operators

```bash
# 1. Deploy (replaces binary, restarts service, runs migration on first DB open)
sudo ./deploy/update.sh    # or manually: install -m 755 folio /opt/folio/folio + restart

# 2. Verify migration
sudo -u folio /opt/folio/folio cloud user-list
# → default | display=default | 1 device | N notes | ...

# 3. Rename the seeded user (optional — keeps things readable)
sudo -u folio /opt/folio/folio cloud user-rename default jarek

# 4. Add a new user
sudo -u folio /opt/folio/folio cloud user-add alice --display "Alice"
sudo -u folio /opt/folio/folio cloud pair-code --user alice
# → hand the 6-digit code to Alice over Signal / SMS / phone

# Alice pairs (her own machine)
folio sync pair --remote https://folio.notibox.ai --code <code>
```

Existing v0.12 clients keep syncing without changes — they never see any user_id in the wire protocol; the cloud derives it from the bearer. Capability URL recipients (no Folio install) are unaffected; URLs continue to work cross-user.

## v0.12.0 — 2026-05-14

Multi-feature polish: install UX, observability, asset pull, real email delivery. Cloud-side runtime changes — VPS deploys need `sudo ./deploy/update.sh` to pick up `/v1/admin/stats`, plaintext-email passthrough on `/v1/share`, and the new PWA install banner. Optional email setup: set `RESEND_API_KEY` + `FOLIO_MAIL_FROM` on the cloud to wire outbound delivery; without them the share endpoint still works and reports `email_skipped="no-mailer"` so the CLI can surface a clear status line.

### Added
- **iOS / Chrome / Edge install banner.** PWA home page now captures `beforeinstallprompt` on browsers that fire it (Chrome/Edge/Samsung) and shows an inline `Install` button. iOS Safari — which doesn't fire that event — gets a dedicated hint: "Tap the Share icon, then 'Add to Home Screen'." Hidden whenever the app is already running standalone (`display-mode: standalone` or legacy `navigator.standalone`); dismissible for the session. SW bumped to `folio-pwa-6`.
- **`GET /v1/admin/stats` (authed) + viewer Cloud stats panel.** Read-only observability snapshot: note/live-entry/asset/share/tombstone counts, DB + asset bytes, per-device `last_seen_at` / `last_pushed_at` / `note_count`, top 20 threads. Local viewer's `/cloud` page gets a new "Cloud stats" card that fetches this when paired, with a refresh button. Bearer token never leaves the local process — viewer proxies via `GET /api/cloud/stats`.
- **Pull-side asset download.** When `syncOnce` pulls a foreign-origin note, the daemon scans its `body_html` for `/t/<thread>/asset/<file>` refs and downloads any bytes missing locally via the cloud's public asset endpoint. Sync output gains `assets_pulled=N`. Idempotent (existing non-empty files skipped) and validated against the same `isSafeAssetFilename` allowlist used on push.
- **Real email delivery for `folio publish --recipient`.** Cloud relay now ships a pluggable mailer (`src/cloud/mailer.ts`) with two providers: **Resend** (HTTP-only — no SMTP lib dep; set `RESEND_API_KEY` + `FOLIO_MAIL_FROM`) and **console** (opt-in dev logger via `FOLIO_MAIL_DEV=1`). `POST /v1/share` accepts `recipient_email` plaintext alongside the existing `recipient_email_hash`; server derives + persists only the hash and uses plaintext for the outbound message. Response includes `email_sent` / `email_skipped` / `email_error` so the CLI can show a clear status line. Mismatched hash/plaintext pairs are rejected. Recipient confirmation flow (HttpOnly cookie gate) is unchanged.

### Improved
- **Sync output adds asset direction arrows** — `assets↑=N` (pushed) `assets↓=N` (pulled) in the daemon's per-iteration log line and the local `/cloud` page's sync result panel. Easier to tell at a glance whether you're publishing or consuming bytes on a given run.
- **Cloud stats endpoint is on every release** — even before paging numbers matter, the per-device "last push / last seen" view makes it trivial to spot a phone that's been offline for weeks or a revoked laptop still listed.

### Notes for operators

Production VPS needs `sudo ./deploy/update.sh` to pick up the cloud changes. To enable outbound email, add to `/etc/folio-cloud/folio-cloud.env`:

```
RESEND_API_KEY=re_yourkeyhere
FOLIO_MAIL_FROM=Folio <folio@yourdomain.tld>
```

Then `sudo systemctl restart folio-cloud`. The Resend "From" domain has to be verified in Resend first — otherwise sends fail and the CLI surfaces the API error. Skipping these vars leaves the share endpoint fully functional minus delivery; capability URLs work as before.

## v0.11.0 — 2026-05-14

Multi-device + sharing maturity. Five post-MVP backlog items + token-hygiene polish. This release has cloud-side runtime changes — VPS deploys need `sudo ./deploy/update.sh` (or a re-run of `bootstrap.sh`) to pick up SSE forwarding, tombstones, recipient binding, and asset cascade.

### Added
- **Cross-device delete tombstones.** Delete on laptop A used to leave laptop B's local copy intact (pull silently missed the gap past the cursor). Cloud now keeps a `tombstones` table, pull returns rows since the caller's cursor, and `applyPulledTombstones` calls `storage.deleteNote` on foreign-origin entries. Own-echo skipped via `origin_device_id`. Sync output gains `deletes_applied=N`.
- **Live note SSE forward through cloud.** New `GET /v1/sync/live-stream?note_uuid=<uuid>` endpoint with `text/event-stream` fan-out from `handlePush.live_entries`. Token accepted via Bearer header OR `?token=` query param (EventSource limitation). PWA `/n/:uuid` shell auto-opens the stream when `X-Folio-Live: 1` is set on `/raw/`, renders a live panel below the iframe. New entries appear in real time with pulsing-orange indicator. Heartbeat every 25s keeps proxies happy.
- **`folio publish --recipient bob@example.com`.** Capability URL bound to a SHA-256 hash of the recipient's email. First visit hits a confirmation form; on email match, server sets a path-scoped HttpOnly cookie. Plaintext email never leaves the publishing client. Reduces blast radius of a leaked URL — both URL and email need to leak before content shows.
- **`deploy/bootstrap.sh`** — one-shot self-host bootstrap. `curl | sudo PUBLIC_URL=https://cloud.example.com bash` downloads the latest release for the target triple, runs `install.sh`, writes the systemd drop-in, generates the first pairing code, and prints the Caddy snippet to paste. Subsequent device pairings still go through `/cloud` UI without SSH.
- **Asset cleanup cascade on delete.** When `handlePush.deletes` removes a note, the cloud scans referenced assets and unlinks any blob with zero remaining referrers (LIKE-scan on body_html across all active notes). Storage reclaim is automatic; `accepted.assets_deleted` in the push response reports what went.

### Improved
- **Token hygiene at pair time.** `~/Folio/.sync-state.json` is now written with `mode 0600` (atomic-rename preserves it). `folio sync pair` output shows only a `AvAE…glEQ` fingerprint instead of nudging the full bearer onto a screen-share or paste-to-chat trap.
- **Release flow documented** with the canonical bump → push branch → PR → merge → pull → tag sequence in CONTRIBUTING.md. Branch protection rationale spelled out (kept on `main`, paid off when an accidental `git add -A` snuck a pnpm-lock.yaml in).

### Notes for operators

Production VPS needs `sudo ./deploy/update.sh` to pick up the cloud changes. Existing v0.10.x clients keep working against a v0.10.x cloud (the new pull tombstones field is optional in the typed response), but you'll want the new endpoints for SSE + recipient binding to actually function.

## v0.10.2 — 2026-05-14

Maintenance + dev-loop quality. No cloud-side runtime changes; existing VPS deploys don't need an update for this release. Local binary picks up:

### Added
- **Playwright PWA test suite.** `bun run test:pwa` drives a real headless Chromium against a real cloud relay, exercises the pair flow, IDB token plumbing, blob-URL iframe handshake, and sandbox attribute integrity. Catches the class of bugs that took multiple deploy/redeploy cycles during W3.
- **`folio doctor` storage + cloud sections.** Bumps install-state-only doctor to a full diagnostic: `folio_home` / `index.sqlite` / bundled themes existence, plus (when paired) cloud reachability, token validity, last-push recency. `--offline` skips network probes; `--json` machine-readable. Auto-emits warnings for unreachable cloud, revoked token, stale (>7d) sync.
- **Upgrade-path integration tests.** `tests/migrations.test.ts` now covers v0.9.1 → v0.10.x (the W2 origin/owner_device_id migration) end-to-end with byte-for-byte previous-version db construction. Plus a v0.8.0 → v0.10.x hop test that exercises both migrations in order. Codifies the regression-test pattern for future schema work.
- **Pre-release maintainer checklist** in CONTRIBUTING.md — seven items including the "first-time-user walkthrough" pass that would have caught delete + TOC + sync UI + print bugs before they hit users.

### Fixed
- **Print outputs only the note body.** Sidebar's "↗ Print / PDF" used to print the full viewer chrome (topbar, sidebar). Now parent posts `{ns:'folio',type:'print'}` to the iframe, which prints itself — clean PDF export.

### Docs
- README refreshed to v0.10.x feature set (cloud sync, PWA, publish, delete, doctor, sync UI). CHANGELOG.md added with v0.7.2+ entries.
- deploy/README.md gains "Test cloud changes locally first" section explaining the FOLIO_CLOUD_PORT=18081 dev-cloud workflow.
- src/core/migrations.ts header comment spells out the two-phase bootstrap discipline: new columns in migrations, new indexes in PHASE2_SCHEMA, never edit a shipped migration.

## v0.10.1 — 2026-05-13

### Added
- **`folio doctor`** extended with `Storage` and `Cloud sync` sections. Checks `folio_home` / `index.sqlite` / bundled themes + templates existence; for paired devices probes cloud reachability + token validity, tracks `last_pushed_at` recency, surfaces actionable warnings (unreachable, token rejected, stale sync). `--offline` skips network probes; `--json` machine-readable.
- **Local viewer `/cloud` page** with two modes: pair form (paste URL + code) when not paired, status + actions (sync now, generate code for new device, unpair) when paired. Backed by `/api/sync/{state,pair,pair-code,run,unpair}` endpoints — bearer token never enters page JS.
- **PWA "+ Add another device"** panel on home — generates pair codes via the new `POST /v1/auth/pair-code` cloud endpoint (authed). Closes the SSH-to-server gap for every device after the first.
- **Topbar ☁ Cloud link** in the local viewer.

### Fixed
- **Print outputs the note, not the chrome.** Previously `window.print()` printed the outer viewer (topbar + sidebar visible in PDF). Now parent posts `{ns:'folio',type:'print'}` to the iframe and the iframe prints itself — clean note-only output.

### Tests
- 270/270 unit (+6 doctor + cloud, +others)
- 6 Playwright headless-browser tests for PWA flows

## v0.10.0 — 2026-05-13

Four-weekend cloud-mvp sprint. Folio becomes a multi-device system.

### Added
- **Cloud Relay (W1).** Bun HTTP server that paired devices push notes + assets to. Bare-metal systemd deploy (`deploy/install.sh`, `update.sh`, Caddy snippet). Single binary + `ProtectSystem=strict` for blast radius comparable to a container, half the moving parts.
- **Sync daemon (W2).** `folio sync pair --remote --code` then `folio sync` as a daemon (or `--once` for cron). Bidirectional push/pull with monotonic cursors for notes + deletes + live entries. Slug collision rename on push + defensive rename on pull. Live notes are owner-locked: foreign live notes can't be appended-to locally; create your own in the same thread instead.
- **Schema v3.** `origin_device_id` + `owner_device_id` columns on notes. UUIDv7-like ULIDs already cross-device unique so no identity migration. Migration in `src/core/migrations.ts` adds the columns; PHASE2 of the two-phase bootstrap creates the index after.
- **PWA (W3).** Phone (or any browser) installs Folio from `/pair`, reads at `/`. App shell is public, contentless JS that reads token from IndexedDB → fetches `/v1/feed` for the list. `/n/:uuid` is a JS shell that explicit-fetches `/raw/:uuid` with auth header and loads it into a sandboxed iframe via blob URL — no SW dependency for auth, no race on first install. Server-side search + thread navigation + native tap-targets + offline cache via SW.
- **`folio publish` (W4).** Capability URLs at `/p/<token>/n/<uuid>` and `/p/<token>/t/<thread>/`. Token is the credential — scope-checked + expiry-checked + max_views-checked on every hit. Asset URLs in shared notes rewritten through `/p/<token>/` so images work without paired devices.
- **`folio shares list|revoke`** for managing active shares.
- **MCP `folio.publish` tool** so agents share a note inline after `create()`.
- **Asset sync.** Sync daemon scans body_html for `/t/<thread>/asset/<file>` refs, HEAD then POST missing assets to `/v1/sync/assets/<hash>`. Public route `/t/<thread>/asset/<file>` serves the bytes (sub-resource fetches from null-origin iframes can't carry bearer headers). Capability-scoped variant gates by token. Backfill scans all active notes so existing assets eventually catch up.
- **`folio delete`** (CLI + viewer sidebar button). Soft-delete to `~/Folio/.trash/` (recoverable 7 days). Sync push propagates the delete to cloud (cascade clears `note_tags` + `live_entries`). Append-only semantics preserved: agents still can't delete via MCP — this is human-only, like `finalize`.
- **TOC depth dropped to h1/h2** because three depths were visual noise. Deeper headings still get anchor IDs via `attachAnchors()` so deep-link URLs continue to work.

### Known scope cuts (post-MVP)
- Pull-side asset download (only writer→cloud direction works; multi-laptop pulls don't auto-fetch bytes)
- Cross-device delete tombstones (delete on A doesn't auto-remove on B; per-device cleanup for now)
- Live note SSE forward (phone shows last-synced snapshot, not the live feed)
- Magic-link recipient binding for shares (column reserved, not exercised)
- `folio cloud bootstrap` one-command self-host (deploy/install.sh exists; the bootstrap wrapper that wires it interactively does not)

## v0.9.1 — 2026-05-12

Hotfix for v0.9.0's upgrade-path crash. Pre-v0.9.0 dbs hit `no such column: live` because `CREATE INDEX IF NOT EXISTS notes_by_live` ran before the migration added the column.

### Fixed
- **Two-phase schema bootstrap.** `PHASE1_SCHEMA` (PRAGMAs + meta) → `runMigrations()` → `PHASE2_SCHEMA` (tables + indexes). Migrations between phases mean every column referenced by an index in PHASE2 is guaranteed to exist.
- New columns now go via `migrations.ts` `up()`; indexes referencing them live in `PHASE2_SCHEMA`. Codified as a convention in `migrations.ts` and `db.ts` header comments.

## v0.9.0 — 2026-05-12

### Added
- **Live notes (ADR-020).** Append-only journal primitive. `create({live:true})` produces a note with a sidecar `<slug>.entries.jsonl`. `folio append <id>` / MCP `append_entry` adds lines. Viewer chrome streams entries via SSE. `finalize` compiles the feed into a static body and flips the note out of live mode.
- MCP tools: `append_entry`, `list_entries`, `set_pinned`.

## v0.8.0 — 2026-05-12

### Added
- **`folio install --target openclaw`** + `--target all`. One-command install across detected MCP clients (Claude Code + OpenClaw). Atomic JSON edits with `.folio-backup-<ts>` taken on first touch.
- **`folio doctor`** (initial). Shows install state per target, warns about broken skill symlinks / stale MCP entries / multiple folio binaries on PATH.

## v0.7.2 — 2026-05-12

### Docs
- Killed the pre-v0.3 "no script in body_html" atavism in `skills/folio/SKILL.md`. Scripts are allowed at body level since v0.3; isolation comes from the outer sandboxed iframe + CSP, not the sanitizer.

## Earlier

`v0.7.x` and below: see git log for details. The repo went public on 2026-05-12 with v0.8.0 as the first announced version; v0.1 through v0.7 were the pre-public iterations.
