# 💾 Folio — Storage

> Pliki HTML są źródłem prawdy. SQLite to cache + search index.

---

## Lokalizacja

Default: `~/Folio/` (override przez `$FOLIO_HOME` albo `folio.config.json`).

```
~/Folio/
├── notes/
│   └── YYYY/MM/<YYYY-MM-DD>_<slug>.html
├── assets/
│   └── YYYY/MM/<note-id>/<file>
├── templates/             # bundled + user overrides
├── index.sqlite
├── folio.config.json
└── .trash/                # soft-deleted
    └── <id>/<original-path>.html
```

`.versions/` dla snapshotów edycji:
```
~/Folio/notes/.versions/<id>/<ISO-timestamp>.html
```

---

## Plik = źródło prawdy

Metadata żyje w `<meta name="folio:...">` + bonusowy `<script type="application/json" id="folio-metadata">` z pełnym JSON-em (łatwiejszy parsing niż meta tagi).

Jeśli `index.sqlite` się zgubi → `folio reindex` chodzi po plikach, parsuje metadata, odtwarza DB. Plik wygrywa.

Konsekwencja: każdy zapis Folio core'a robi dwie rzeczy:
1. `fs.writeFile` HTML
2. UPSERT do SQLite

Order: **najpierw plik, potem DB**. Jeśli pad między → reindex naprawi.

---

## SQLite schema (v1)

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO meta (key, value) VALUES ('schema_version', '1');

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  created TEXT NOT NULL,
  updated TEXT NOT NULL,
  word_count INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'active'   -- active | trashed
);
CREATE INDEX notes_by_type ON notes(type, updated DESC);
CREATE INDEX notes_by_updated ON notes(updated DESC);

CREATE TABLE tags (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (note_id, tag)
);
CREATE INDEX tags_by_tag ON tags(tag);

CREATE TABLE links (
  src_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  dst_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  rel TEXT NOT NULL DEFAULT 'related',
  created TEXT NOT NULL,
  PRIMARY KEY (src_id, dst_id, rel)
);

CREATE TABLE versions (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  path TEXT NOT NULL,         -- relative to .versions/<id>/
  created TEXT NOT NULL,
  reason TEXT,                -- 'manual' | 'llm-edit' | 'patch'
  PRIMARY KEY (note_id, version)
);

CREATE VIRTUAL TABLE notes_fts USING fts5(
  id UNINDEXED,
  title,
  body,
  tags,
  content='',                  -- external content (we manage manually)
  tokenize='porter unicode61'
);
```

### Operacje atomowe

- Single transaction per write: `BEGIN → UPSERT notes → DELETE/INSERT tags → DELETE/INSERT fts → COMMIT`.
- Lock plików: zapis HTML idzie do `<file>.tmp`, potem `rename` (atomic na POSIX).

---

## ID-y

- ULID (`01HN8...`) — sortable po czasie, krótsze niż UUID, kompatybilne URL-safe.
- 26 znaków, base32.
- Generowane przez `ulid` paczkę (lub własną).

---

## Slug

- Z tytułu: lowercase, ASCII, kebab-case, max 80 znaków.
- Polskie znaki → translit (`ą→a, ł→l, ż→z, ó→o, …`).
- Konflikt → suffix `-2`, `-3`…
- Slug może się zmienić (rename), id zostaje.

---

## File watcher

`fs.watch` (recursive=true) na `notes/`:
- Add → reindex pliku.
- Modify → reindex.
- Delete → mark `status='trashed'` w DB (jeśli plik usunięty zewnętrznie).

Debounce 200ms (edytory typu vim robią write→delete→write).

---

## Reindex flow

1. Scan `notes/` rekurencyjnie (glob `**/*.html`).
2. Per plik: parse meta + content (jsdom albo własny lekki parser na regex dla meta).
3. UPSERT do SQLite.
4. Compute body text (strip HTML) → FTS row.
5. Po końcu: delete z DB to, czego nie ma na dysku.

---

## HTML parsing

Bun ma `HTMLRewriter` (Cloudflare-style) — szybsze niż jsdom dla naszych potrzeb.

Wyciągamy:
- `<title>`
- `<meta name="folio:*">`
- `<script id="folio-metadata">` (priorytet — to source-of-truth)
- `<article data-folio-content>` body → strip do plain text dla FTS

Sanityzacja przy WPISIE (nie odczycie).

---

## Migracje schematu

```
~/Folio/index.sqlite zawiera meta.schema_version
src/core/migrations/v0001_init.sql
src/core/migrations/v0002_add_X.sql
```

Bun na starcie: czyta `schema_version`, aplikuje brakujące migracje w kolejności.

---

## Backupy

`folio backup` → zip z `notes/`, `templates/`, `folio.config.json`. **Bez** `index.sqlite` (odtworzymy reindexem) i bez `.versions/` (opcjonalnie via flag).

Schedule: agent może odpalać `folio backup --out ~/Backups/Folio/$(date +%F).zip` z crona.

---

## Limity i wydajność

- 1 nota = max 2MB HTML (osobny limit dla assets).
- FTS5 z 50k notatek = ~100ms search. Z 500k = secs — wtedy wprowadzimy partitioning per rok.
- Watcher na 100k+ plików = wolny startup → optymalizacja: cache modification times w DB, skipuj niezmienione.
