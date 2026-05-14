<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/wordmark-dark.svg">
  <img src="assets/wordmark-light.svg" alt="folio. — visual comm for agents" width="420">
</picture>

> Visual communication layer between AI agents and humans.

When your agent has something to show — research, comparison, technical doc, scorecards, color-coded findings, sortable tables, embedded interactive demos — Folio renders it as a **single standalone HTML file** on your disk, served by a local viewer, addressable from any MCP client.

**What you get:**

- 🎨 **18 themes** with structural CSS the agent uses (`.eyebrow`, `.lead`, `.pill`, `.card`, `.verdict`, …) — drop your own folder under `~/Folio/themes/` and it shows up live
- 📂 **Notes as plain HTML files** in `~/Folio/threads/<topic>/` — append-only, no database lock-in, `tar` and walk away
- 🔎 **SQLite FTS5 full-text search** with Polish-aware tokenizer + suffix stemmer
- 🧩 **MCP server** (`folio-mcp`) — 11 tools, works with OpenClaw, Claude Code, Claude Desktop, Cursor, Continue
- 🖼️ **Local viewer** at `127.0.0.1:4810` — iframe-isolated themes, lightbox, TOC with scroll spy, prev/next-in-thread
- 📎 **Attach assets** (images / PDFs / videos) to threads with hardened filename + extension validation
- ⚡ **Pre-compiled binaries** for darwin-arm64 / linux-x64 / linux-arm64 — no runtime dependency

> *Folio is not a knowledge base. It's the surface on which your current conversation with an agent renders. Markdown is flat — Folio is where the agent stops describing and starts showing.*

---

## Status

**v0.14.0 — multi-user cloud + operator dashboard, shippable.** Public release: 2026-05-14.

- ✅ Core flow: agent → MCP `create` → note on disk → `/n/<id>` renders
- ✅ Sync daemon (`folio sync`) mirrors `~/Folio/` to an optional cloud relay — bidirectional notes + assets + tombstones
- ✅ Read-only PWA on phone with install banner (`beforeinstallprompt` on Chrome/Edge, inline Share→Add-to-Home-Screen hint on iOS Safari)
- ✅ Live note SSE forwarding through cloud — phone watches new entries in real time
- ✅ `folio publish` mints capability URLs to share a note (or whole thread) with someone who has no Folio install; with `--recipient` the cloud emails the link via Resend
- ✅ Cloud observability snapshot (`GET /v1/admin/stats` + viewer Cloud stats panel) — counts, bytes, per-device last-seen
- ✅ Soft-delete (`folio delete`, `.trash/` with 7-day grace) plus sidebar button in the viewer
- ✅ Append-only (ADR-014) preserved end-to-end: agents iterate via new sibling notes, never edits
- ✅ Pre-compiled tarballs for darwin-arm64 / linux-x64 / linux-arm64; `folio update` self-updates from GitHub Releases

The MCP contract is stable for v0.x. Cloud + PWA + publish ride on the same machinery — opting in to one doesn't lock you out of the others.

---

## Why Folio vs …

- **vs Claude Artifacts / OpenAI Canvas** — local-first, your filesystem, no vendor lock-in. Threads of notes (not single isolated artifacts), addressable from any MCP-capable client, not coupled to one chat product.
- **vs Obsidian / SilverBullet / Notion** — HTML not Markdown, designed for agents to write and humans to read. Sandboxed iframes for embedded demos. Append-only by design — the agent can never overwrite your prior take, only add another angle in the same thread.
- **vs a folder of `.html` files** — indexed (FTS5), themed (18 bundled), addressable (`/n/<id>`), served, MCP-wired, lifecycle-managed (30-day auto-cleanup unless `finalize`d).

The product is the **filesystem + viewer + MCP contract**, not a hosted app. Every note is a valid standalone HTML file that opens in any browser, with or without Folio running.

---

## Install

**From a release** (recommended):

```bash
# Pick the right tarball for your machine
TARGET=darwin-arm64    # or linux-x64, or linux-arm64

curl -L "https://github.com/jzmudzinski/folio/releases/latest/download/folio-${TARGET}.tar.gz" \
  | tar xz -C /tmp/folio-install
cd /tmp/folio-install && ./install.sh
export PATH="$HOME/.local/folio:$PATH"      # add to your shell rc

folio init
folio serve     # http://127.0.0.1:4810
```

**From source** (you want to hack on it):

```bash
git clone https://github.com/jzmudzinski/folio.git
cd folio && bun install
bun bin/folio.ts init
bun bin/folio.ts serve
```

Requires Bun 1.3+ for source install. Release tarballs ship pre-compiled single-file binaries — no runtime dependency.

---

## How it works in 60 seconds

1. An MCP-capable agent (OpenClaw, Claude Code, Claude Desktop, Cursor, Continue, …) connects to `folio-mcp` over stdio.
2. When the agent has something visual to show — research, comparison, technical doc, interactive demo — it calls `create` with an HTML body and a theme.
3. The note lands at `~/Folio/threads/<topic>/<slug>.html` and the agent replies with `http://127.0.0.1:4810/n/<id>`.
4. You open the link in a browser. The local viewer renders the note in the chosen theme, attaches a sidebar with metadata + actions, and stays out of the way.
5. Want another angle? Tell the agent. It writes a new note in the same thread folder. The previous one stays intact (Folio is append-only). Mark the best one as "final" — it skips the 30-day auto-cleanup.

---

## Commands

| Command | What |
|---|---|
| `folio init` | Bootstrap `~/Folio/` (or `$FOLIO_HOME`) |
| `folio new --title T --type X --html @file.html` | Create a note from an HTML fragment |
| `folio list [--type] [--thread] [--final] [--json]` | List recent notes |
| `folio search "query" [--type] [--json]` | FTS5 full-text search (Polish-aware) |
| `folio append <id> [--content @file] [--tags] [--refs]` | Append entry to a live note (ADR-020) |
| `folio finalize <id>` | Mark as final — skip auto-cleanup; live → static body |
| `folio delete <id> [--yes]` | Soft-delete to `~/Folio/.trash/` (recoverable 7d), propagates to cloud on next sync |
| `folio open <id\|slug>` | Open note URL in default browser |
| `folio export <id> [--standalone] [--out path]` | Export a single self-contained HTML |
| `folio cleanup [--dry-run]` | Trash non-final notes past expiry (30d default) |
| `folio reindex` | Rebuild FTS index from files on disk |
| `folio stats` | Counts + analytics |
| `folio serve` | Local viewer on `:4810` |
| `folio sync pair --remote <url> --code <6-digit>` | Pair this device with a Folio Cloud relay |
| `folio sync [--once] [--interval 30]` | Push/pull daemon (or one-shot) against the paired cloud |
| `folio sync status` / `unpair` | Inspect / clear local sync state |
| `folio publish <id\|thread:slug> [--expires-days 7] [--max-views N]` | Mint a capability URL share |
| `folio shares list` / `revoke <token>` | Manage active shares |
| `folio cloud {init\|serve\|pair-code}` | Run a cloud relay (operator side) |
| `folio doctor [--offline] [--json]` | Install + storage + cloud sync diagnostics |
| `folio update [--check] [--force] [--pre] [--json]` | Self-update from GitHub releases |
| `folio version [--json]` | Print Folio version + storage / viewer / theme info (alias: `--version`, `-v`) |
| `folio-mcp` | Stdio MCP server for agent clients |

Environment: `FOLIO_HOME=/path` overrides storage root. `FOLIO_DEBUG=1` for stack traces.

---

## Agent integration

Folio is built around the MCP protocol. The server (`folio-mcp`) exposes **11 tools** (`create`, `get`, `list`, `search`, `finalize`, `unfinalize`, `suggest_thread`, `list_expiring`, `list_themes`, `export`, `version`) and **6 resources** for context-loading. The server name is `folio`, so mcporter-style clients invoke them as `folio.create`, `folio.search`, etc.

### OpenClaw + mcporter

```bash
mcporter config add folio --command folio-mcp --scope home

# Optional: install the skill so agents know when/how to call Folio
ln -s "$HOME/.local/folio/skills/folio" "$HOME/.openclaw/workspace/skills/folio"
```

### Claude Desktop

```jsonc
// ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "folio": { "command": "folio-mcp" }
  }
}
```

### Claude Code / Cursor / Continue

Most MCP-capable clients accept the same shape: command `folio-mcp`, no args. See [`docs/mcp-setup.md`](docs/mcp-setup.md) for details.

### One-command install

`folio install` wires both the agent skill and the MCP server into a supported client. Two targets ship today:

- **`--target claude-code`** — symlinks the skill to `~/.claude/skills/folio` and adds an entry under `projects[<scope>].mcpServers.folio` in `~/.claude.json`. MCP wiring is per-project (Claude Code's model).
- **`--target openclaw`** — symlinks the skill to `~/.openclaw/workspace/skills/folio` and adds an entry under `mcp.servers.folio` in `~/.openclaw/openclaw.json`. Global, no per-project scope.
- **`--target all`** — both. Default in non-interactive mode (e.g. CI) when both clients are detected.

```bash
folio install                          # interactive: detects clients, asks if both present
folio install --target claude-code     # explicit single target
folio install --target openclaw        # explicit single target
folio install --target all             # wire to every supported target
folio install --scope ~/Projects/app   # Claude Code per-project scope (ignored for openclaw)
folio install --skill-only             # skip MCP wiring
folio install --mcp-only               # skip skill, just MCP
folio install --dry-run                # show planned changes, don't apply
folio install --yes                    # accept all prompts (skips interactive scope question)

folio uninstall                        # remove from current project (claude-code default)
folio uninstall --target all           # remove from every supported client
folio uninstall --all-scopes           # remove folio MCP from every Claude Code project
folio doctor                           # show install state for every detected target
folio doctor --json                    # machine-readable
```

What `install` touches per target:

| Target | Skill path | MCP config | Notes |
|---|---|---|---|
| `claude-code` | `~/.claude/skills/folio` (symlink) | `~/.claude.json` → `projects[<scope>].mcpServers.folio` | Per-project. Cursor / Claude Desktop are follow-ups. |
| `openclaw` | `~/.openclaw/workspace/skills/folio` (symlink) | `~/.openclaw/openclaw.json` → `mcp.servers.folio` | Global. Also strips stale `skills.load.extraDirs` entries ending in `/skills/folio`. Preserves any `env` you set (e.g. `FOLIO_HOME`). |

Both targets get atomic JSON writes with a `.folio-backup-<ts>` taken on first touch this session. After a `folio update`, install entries on every wired target are auto-refreshed so the MCP `command:` path follows the binary.

### Public URL (reverse proxy)

Folio binds to `127.0.0.1:4810` by default. When you reverse-proxy the viewer to a public host (Tailscale Funnel, Caddy, ngrok, …), agents and bots that relay note links — Telegram, email, Slack — should surface that public URL, not `localhost`. Set `viewer_public_url` in `~/Folio/folio.config.json`:

```json
{
  "theme": "linen",
  "viewer_port": 4810,
  "viewer_host": "127.0.0.1",
  "viewer_public_url": "https://notes.example.com"
}
```

Effect: `folio.create` returns `public_url` + a `response_hint` (the `MEDIA:` line) that uses it; `local_url` stays for in-process tooling. Notes' internal links are relative (`/n/<id>`), so existing notes render unchanged behind either base — no migration needed.

### Attaching assets to notes

`folio.attach_asset` lets an agent (or bot) drop an image, PDF, or video into a thread and reference it from `body_html`. Files live next to the thread's `*.html` notes under `threads/<thread_id>/assets/`, so a single `tar` of `~/Folio/` covers them automatically.

```jsonc
// MCP call
{
  "tool": "attach_asset",
  "args": {
    "thread_id": "morning-ride-2026-05-12",
    "filename": "speed-chart.png",
    "content_base64": "iVBORw0KGgo…"     // or: "source_path": "/tmp/chart.png"
  }
}
// Response
{
  "thread_id": "morning-ride-2026-05-12",
  "filename": "speed-chart.png",
  "path":  "~/Folio/threads/morning-ride-2026-05-12/assets/speed-chart.png",
  "url":   "https://notes.example.com/t/morning-ride-2026-05-12/asset/speed-chart.png",
  "local_url": "http://127.0.0.1:4810/t/…/asset/speed-chart.png",
  "size_bytes": 23184
}
```

Hardened by design:

- Filename must match `^[a-zA-Z0-9._-]+$`, ≤200 chars, no leading/trailing dot, no `..`. Path separators are rejected.
- Extension whitelist: `jpg` / `jpeg` / `png` / `webp` / `gif` / `svg` / `pdf` / `mp4`. Anything else → `415` on GET.
- Served with `Content-Type` sniffed from extension, `X-Content-Type-Options: nosniff`, `Cache-Control: public, max-age=86400`.
- No implicit URL rewrite in `body_html` — the agent embeds the absolute or relative URL it received. Predictable contract, no surprise edits to the note.

Re-attaching the same filename overwrites in place (idempotent uploads). Notes themselves are still append-only.

---

## Cloud sync (optional)

`folio serve` keeps everything on `127.0.0.1:4810` — but if you want notes on your phone (offline-capable PWA) or to share a note with someone over the internet, point a small relay at an existing VPS and tie devices to it.

The relay is the same Folio binary in a different mode:

```bash
# On a VPS (the operator side) — one-shot bootstrap, all of the below:
curl -L https://github.com/jzmudzinski/folio/raw/main/deploy/bootstrap.sh \
  | sudo PUBLIC_URL=https://folio.example.com bash

# Or step-by-step if you'd rather inspect:
sudo ./deploy/install.sh        # systemd unit, bare-metal, no docker — see deploy/README.md
sudo systemctl edit folio-cloud # set FOLIO_CLOUD_PUBLIC_URL=https://folio.example.com
sudo systemctl restart folio-cloud
sudo -u folio /opt/folio/folio cloud pair-code     # first pairing code (10-min TTL)
```

```bash
# On the laptop (operator), first pair:
folio sync pair --remote https://folio.example.com --code 482910
# Or via the local viewer: http://127.0.0.1:4810/cloud (form for code paste)

# Run the daemon (in the background):
folio sync
# Or one-shot in cron / before a flight:
folio sync --once
```

Every subsequent device pairs through the UI — no SSH:

```
laptop /cloud → "Generate code for another device" → 482910
phone /pair  → enter 482910 → done
```

Phone gets `https://folio.example.com` as a PWA — install to home screen from Safari/Chrome, browse notes offline, tap a thread name to filter. Read-only by design: notes are created on the writer device, the PWA never writes.

### `folio publish` — share with someone who has no Folio

```bash
folio publish <note-id> --expires-days 7
# → https://folio.example.com/p/Hk3xQ.../n/<note-id>
folio publish thread:morning-review --max-views 50
folio shares list
folio shares revoke Hk3xQ...
```

Recipients click the link, see the note rendered in its theme. No login, no app, no account. Capability URL gets `Referrer-Policy: no-referrer` + `X-Robots-Tag: noindex` so it stays out of search indexes and external Referer logs. Token-bound expiry + max-views + revoke. Asset URLs in the body rewrite through the same `/p/<token>/` prefix so images work without paired devices.

### Diagnostics

When something looks off, `folio doctor` checks install, storage, and cloud sync state in one pass:

```bash
folio doctor                     # full report
folio doctor --offline           # skip network probes
folio doctor --json              # machine-readable
```

Surfaces the common failure modes: cloud unreachable, token rejected, last sync > 7 days, themes missing next to a compiled binary, MCP install symlinks stale.

---

## Themes

18 themes ship bundled, each with two files:

- `theme.css` — CSS variables + utility classes (`.eyebrow`, `.lead`, `.pill`, `.card`, `.verdict`, …) the agent uses for structure
- `theme.md` — prompt addendum the Skill injects so the agent matches the theme's voice and structure

Defaults: `linen` (warm cream, Familjen Grotesk + Instrument Serif italic, orange accent). Switch per-note via `create({ theme })` or globally in `~/Folio/folio.config.json`.

Drop your own folder at `~/Folio/themes/<name>/` and it appears in the viewer dropdown immediately — no restart, no rebuild.

Full theme list and contract: [`themes/README.md`](themes/README.md).

---

## Architecture

- **Bun** runtime + TypeScript (no build step in dev; `bun build --compile` for release binaries)
- **`bun:sqlite`** with FTS5 for local storage + search (Polish-aware tokenizer + suffix stemmer). Two-phase schema bootstrap with migrations between (`src/core/migrations.ts`); BASE_SCHEMA never references a column added in the same release.
- **`sanitize-html`** for agent body sanitization — forces safe sandboxes on `<iframe>` (no `allow-same-origin` ever passes through, `https:` only, `on*` handlers stripped). Note: `<script>` IS allowed at body level since v0.3 because notes render inside a null-origin sandboxed iframe with `connect-src: 'none'` — isolation comes from the outer iframe + CSP, not the sanitizer.
- **Eta** templates wrap agent-supplied HTML in a theme-linked document.
- **Vanilla viewer** — server-rendered HTML + ~300 LOC of vanilla JS for the helpers (lightbox, copy-code, heading anchors, TOC with scroll spy, reading progress, theme preview switcher, prev/next in thread, print via postMessage so chrome doesn't leak into the PDF).
- **One Folio binary, three modes:** `folio serve` (local viewer, default), `folio sync` (push/pull daemon against a cloud relay), `folio cloud serve` (the relay itself — reuses the same viewer + theme stack with bearer auth on top).
- **PWA** = stateless JS shells served by the cloud relay. Token lives in IndexedDB only; service worker SWR-caches notes for offline reads.
- **Capability URLs** are 32-byte b64url tokens server-side; scope is enforced per-request (note vs thread). Body asset URLs rewrite through `/p/<token>/` so shared notes render with images and the iframe sandbox stays null-origin.
- **MCP SDK** for the stdio server (`folio-mcp` over stdio for OpenClaw / Claude Desktop / Claude Code).

No React, no frontend framework, no build step at runtime. Notes are pure HTML files; the viewer renders them through an iframe so theme.css is isolated from viewer chrome.

---

## Hacking on Folio

[`AGENTS.md`](AGENTS.md) is the canonical "how to work on this codebase" guide — file layout, conventions, hard rules, common pitfalls. Read it before adding tools, themes, or viewer helpers.

Tests:
- `bun test` runs the unit suite (270+ tests, ~3s). Covers storage, MCP tools, viewer routes, cloud auth + sync, share validation, doctor diagnostics.
- `bun run test:pwa` runs the Playwright headless-browser suite (~2s after first browser install via `bun run test:pwa:install`). Covers pair flow, IDB token, blob-URL iframe handshake, sandbox attribute integrity.

Branch protection on `main` means changes flow through PRs. Release flow: PR merge → `git tag v0.X.Y` on the merge commit → `git push origin v0.X.Y` triggers `.github/workflows/release.yml` which builds the three target triples and publishes a GitHub Release.

---

## License

[MIT](LICENSE).
