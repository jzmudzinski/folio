<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/wordmark-dark.svg">
  <img src="assets/wordmark-light.svg" alt="folio. — visual comm for agents" width="420">
</picture>

> Visual communication layer between AI agents and humans.

Markdown is flat. Folio is the medium where an AI agent stops *describing* something and starts *showing* it — scorecards, color-coded findings, sortable tables, embedded interactive demos, all in a single standalone HTML file that lives on your disk and travels anywhere.

Folio is not a knowledge base. It's the surface on which your current conversation with an agent renders.

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
| `folio finalize <id>` | Mark as final — skip auto-cleanup |
| `folio open <id\|slug>` | Open note URL in default browser |
| `folio export <id> [--standalone] [--out path]` | Export a single self-contained HTML |
| `folio cleanup [--dry-run]` | Trash non-final notes past expiry (30d default) |
| `folio reindex` | Rebuild FTS index from files on disk |
| `folio stats` | Counts + analytics |
| `folio serve` | Local viewer on `:4810` |
| `folio update [--check] [--force] [--pre] [--json]` | Self-update from GitHub releases |
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
- **`bun:sqlite`** with FTS5 for storage and search (Polish-aware tokenizer + suffix stemmer)
- **`sanitize-html`** for agent body sanitization — drops top-level `<script>`, forces safe sandboxes on `<iframe>` (no `allow-same-origin` ever passes through, `https:` only, `on*` handlers stripped)
- **Eta** templates wrap agent-supplied HTML in a theme-linked document
- **Vanilla viewer** — server-rendered HTML + ~300 LOC of vanilla JS for the helpers (lightbox, copy-code, heading anchors, TOC with scroll spy, reading progress, theme preview switcher, prev/next in thread)
- **MCP SDK** for the stdio server

No React, no frontend framework, no build step at runtime. Notes are pure HTML files; the viewer renders them through an iframe so theme.css is isolated from viewer chrome.

---

## Hacking on Folio

[`AGENTS.md`](AGENTS.md) is the canonical "how to work on this codebase" guide — file layout, conventions, hard rules, common pitfalls. Read it before adding tools, themes, or viewer helpers.

Tests: `bun test` (a few dozen, ~700ms). Branch protection on `main` means changes flow through PRs.

---

## License

[MIT](LICENSE).
