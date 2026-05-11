# 🏗️ Folio — Architecture

## High-level diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                          AGENT (LLM)                            │
│         (Claude / Ryszard / OpenClaw / Cursor / …)              │
└──────────────────────────────┬──────────────────────────────────┘
                               │ MCP protocol (stdio/HTTP)
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Folio MCP Server                          │
│      tools: create, search, get, update, list, link, tag        │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Folio Core (lib)                           │
│  ┌──────────────┐  ┌─────────────────┐  ┌──────────────────┐    │
│  │ Storage API  │  │ Template engine │  │  Search (FTS5)   │    │
│  └──────┬───────┘  └────────┬────────┘  └─────────┬────────┘    │
└─────────┼──────────────────┼──────────────────────┼─────────────┘
          ▼                   ▼                      ▼
   ┌────────────┐   ┌──────────────────┐    ┌────────────────┐
   │ notes/*.html │   │ templates/*.eta │    │ index.sqlite   │
   │   (disk)     │   │ + theme.css     │    │ (metadata + FTS)│
   └────────────┘   └──────────────────┘    └────────────────┘
          ▲
          │
┌─────────┴───────────────────────────────────────────────────────┐
│                        CLI / Viewer                              │
│   `folio new` `folio search` `folio serve` (Bun HTTP server)    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Storage layout

```
~/Folio/                       # user-configurable root
├── notes/
│   └── 2026/
│       └── 05/
│           ├── 2026-05-11_obsidian-vs-affine.html
│           └── 2026-05-11_rag-vs-fine-tuning.html
├── assets/                    # obrazki, fontów embed itp.
│   └── 2026/05/<note-id>/...
├── templates/                 # bundled + user overrides
│   ├── _base.html.eta
│   ├── theme.css
│   ├── comparison.html.eta
│   ├── research.html.eta
│   ├── journal.html.eta
│   ├── technical.html.eta
│   └── snippet.html.eta
├── index.sqlite               # metadata + FTS5
└── folio.config.json          # user prefs (theme, paths, MCP port)
```

### Filename convention

`YYYY-MM-DD_<slug>.html`

- `slug` = kebab-case, ascii-only, max 80 znaków
- Konflikt slug? → dopisz `-2`, `-3`…
- Plik ma w `<meta>` UUID — slug może się zmienić, id zostaje

---

## HTML note structure

Każda notatka = **self-contained HTML**:

```html
<!doctype html>
<html lang="pl">
<head>
  <meta charset="utf-8">
  <meta name="folio:id" content="01HN8...">
  <meta name="folio:type" content="comparison">
  <meta name="folio:created" content="2026-05-11T00:17:00Z">
  <meta name="folio:updated" content="2026-05-11T00:21:00Z">
  <meta name="folio:tags" content="obsidian,affine,trilium,tools">
  <meta name="folio:links" content="01HN8AA...,01HN8BB...">
  <title>Obsidian vs Affine vs Trilium</title>
  <style>/* inline theme.css — self-contained */</style>
</head>
<body>
  <article data-folio-content>
    <!-- generated content -->
  </article>
  <script type="application/json" id="folio-metadata">
    {"id":"...","type":"comparison","schema":1}
  </script>
</body>
</html>
```

**Klucz:** metadata żyje **w samym pliku** (w `<meta>`) + w SQLite (cache). Jeśli SQLite się zgubi → odtwarzamy z plików. Plik jest źródłem prawdy.

---

## SQLite schema

```sql
-- notes: metadata cache
CREATE TABLE notes (
  id TEXT PRIMARY KEY,                -- ULID
  slug TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,          -- relative do root
  title TEXT NOT NULL,
  type TEXT NOT NULL,                 -- comparison/research/...
  created TEXT NOT NULL,              -- ISO8601
  updated TEXT NOT NULL,
  word_count INTEGER,
  summary TEXT
);

CREATE TABLE tags (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (note_id, tag)
);
CREATE INDEX tags_by_tag ON tags(tag);

CREATE TABLE links (
  src_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  dst_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  rel TEXT,                           -- 'related', 'cited', 'follow_up'
  PRIMARY KEY (src_id, dst_id, rel)
);

-- Full-text search
CREATE VIRTUAL TABLE notes_fts USING fts5(
  id UNINDEXED,
  title,
  body,           -- HTML-stripped text
  tags,
  tokenize='porter unicode61'
);
```

### Reindex strategy

- Watcher (`fs.watch` Bun) na `notes/` → przy zmianie pliku reindex.
- `folio reindex` — ręczny full rescan.
- Plik > DB. Konflikt = wygrywa plik.

---

## Template engine

Eta (lightweight EJS-like) bo:
- ~6KB
- Async-friendly
- Inherits-style (master template + child)

### Base template
`_base.html.eta` zawiera:
- DOCTYPE + meta + tytuł
- `<style>` z inline'owanym `theme.css` (build-time concat)
- Slot na `<%~ it.content %>`
- Skrypt z folio-metadata JSON

### Theme (`theme.css`)
Jedno źródło. Variables w `:root` (jak w przykładzie z porównania) — `--bg`, `--accent`, `--good`, `--bad`, typografia, spacing.

Per-template overrides w bloku `<style>` po inline'owanym theme.

### Typy notatek (S2 zakres)
- **comparison** — tabele scorecard, plusy/minusy, werdykt
- **research** — sekcje (TL;DR, deep dive, sources, open questions)
- **journal** — chronologiczny, daty, mood
- **technical** — code blocks, diagrams, ADR-style
- **snippet** — krótka notka, single-card layout

---

## MCP server interface

Patrz [[Features/MCP-Server]] po pełne schemy. W skrócie:

```
folio.create({ type, title, prompt|body_html, tags?, links? }) → { id, path, url }
folio.search({ query, limit?, tags?, type? }) → [{ id, title, snippet, score }]
folio.get({ id }) → { id, metadata, body_html, body_text }
folio.update({ id, body_html?, title?, tags?, append? }) → { id, updated }
folio.list({ tag?, type?, since?, limit? }) → [{ id, title, created, type }]
folio.link({ src_id, dst_id, rel? }) → { ok }
folio.delete({ id }) → { ok }
```

**Transport:** stdio (lokalnie) + HTTP (gdy `folio serve` chodzi).

---

## CLI surface

```
folio init                         # create ~/Folio with config + templates
folio new "title" [--type X]       # interactive
folio new --from-template X --title "..." --content @file.html
folio list [--tag T] [--type X]
folio search "query"
folio open <id|slug>               # `open` w macOS
folio edit <id>                    # otwiera plik w $EDITOR
folio link <id-a> <id-b> [--rel R]
folio tag <id> +tag1 -tag2
folio delete <id>
folio reindex
folio serve [--port 4810]
folio export <id> [--format md|pdf]
folio import <path>                # import istniejących plików md/html
```

---

## Viewer (S5)

Bun HTTP server (`folio serve`):

- `GET /` — lista notatek (paginated, filterable)
- `GET /n/:id` — render notatki (po prostu serve pliku)
- `GET /search?q=...` — SSR search z FTS
- `GET /tags` — chmurka tagów
- `GET /graph` — minimal force-directed graph (D3 albo Cytoscape)
- `POST /api/notes` — create (auth: localhost only)
- `POST /api/notes/:id/edit-with-llm` — agent edit (S6)

UI: tailwind v4 (CSS only, bez build step) albo plain CSS w stylu themu. **Bez React.** Server-rendered HTML + odrobina vanilla JS na search live.

---

## Bezpieczeństwo / kontrowersje

- **Sanityzacja HTML od LLM:** Folio core przepuszcza body przez `DOMPurify` (lub `sanitize-html`) zanim zapisze. LLM mógłby wrzucić `<script>` — nie chcemy.
- **MCP localhost-only:** stdio domyślnie, HTTP tylko gdy explicit i bound do 127.0.0.1.
- **No auto-execute:** Folio nigdy nie odpala `<script>` z notatek. CSP w viewerze blokuje JS w `<article>` (poza folio-metadata).
- **Backups:** prosty `folio backup` zipuje `~/Folio/` z timestampem.

---

## Decyzje architektoniczne

Patrz [[Decisions]] po listę ADR-ów (ADR-001: dlaczego Bun, ADR-002: dlaczego SQLite a nie JSON, ADR-003: HTML over Markdown, ADR-004: MCP zamiast / oprócz Skilla, …).
