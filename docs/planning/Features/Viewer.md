# 👀 Folio — Viewer

> Lokalny webowy interfejs do bazy notatek. `folio serve` → przeglądarka.

---

## Cel

- Mieć przeglądalny widok notatek w jednym miejscu.
- Search z FTS5, filtry po tagu/typie.
- Render pojedynczej notki (po prostu serwujemy plik HTML).
- "Ask AI to edit" inline z viewer'a (S6).
- Mini graph view (S7).

**Bez React, bez build step.** Bun HTTP server + server-rendered HTML + odrobina vanilla JS.

---

## Routes

| Method | Path | Działanie |
|---|---|---|
| GET | `/` | Lista notatek (paginated) |
| GET | `/search?q=&type=&tag=` | Search results |
| GET | `/tags` | Tag cloud |
| GET | `/graph` | Force-directed graph (links) |
| GET | `/n/:id` | Render notatki (200 + body pliku) |
| GET | `/n/:id/edit` | Edytor (S6) |
| GET | `/recent` | 20 ostatnich (RSS-style) |
| GET | `/api/list?...` | JSON list |
| GET | `/api/search?...` | JSON search |
| POST | `/api/notes` | Create (auth required) |
| POST | `/api/notes/:id/edit-with-llm` | LLM-powered edit (S6) |
| DELETE | `/api/notes/:id` | Soft delete |
| GET | `/health` | Healthcheck |
| GET | `/sse` | Server-Sent Events: hot reload przy zmianach plików |

---

## UI components

Vanilla HTML, używają **tego samego theme.css** co notatki — viewer wygląda jak rodzina notatek.

### Lista (`/`)
- Sticky top bar z search input + filtry (chips: tag, type, sort).
- Grid kafelków z metadanymi (title, type tag, data, summary).
- Klik → `/n/:id` w nowej karcie (default).
- Lazy load (infinite scroll) co 50.

### Search results (`/search`)
- FTS5 snippet z highlightem.
- BM25 score widoczny (debug-mode).
- Filtry po prawej (collapse na mobile).

### Tag cloud (`/tags`)
- Tagi ważone (font-size od `count`).
- Klik → `/?tag=X`.

### Note view (`/n/:id`)
- Po prostu serwujemy plik HTML z `notes/`.
- W `<head>` wstrzykujemy maleńki `<link rel="stylesheet">` z **floating sidebar** (back / edit / tags / metadata / linked-from) — tylko gdy view źródłem jest viewer (header `X-Folio-Viewer: 1`).
- Sidebar wstrzykiwany przez middleware, nie modyfikuje samego pliku na dysku.

### Edit (`/n/:id/edit`)
- Code editor (CodeMirror albo prosty `<textarea>`).
- "Save" → PUT API.
- "Ask AI to edit" — textarea z instrukcją → POST do edit-with-llm.
- Diff view (przed/po) z accept/reject.

### Graph (`/graph`)
- D3 force-directed albo Cytoscape.
- Nodes = notatki, edges = links.
- Filtry: type/tag.
- Klik nodea → pokaż preview po prawej.

---

## Implementacja

Pseudo-struktura:

```
src/viewer/
  server.ts              # Bun.serve(...)
  routes/
    index.ts             # /
    search.ts            # /search, /api/search
    note.ts              # /n/:id (+ middleware sidebar)
    api.ts               # /api/*
    graph.ts             # /graph
  partials/              # HTML helpers (cards, table, sidebar)
  static/
    viewer.css           # extras dla viewer-only UI
    viewer.js            # ~200 linii vanilla JS
```

Bun.serve handler routuje per path. Response = `new Response(html, { headers: {...} })`.

---

## Server-Sent Events (hot reload)

Endpoint `/sse` — fs.watch event-y idą jako SSE:

```
event: note:created
data: {"id": "01HN...", "path": "..."}

event: note:updated
data: {"id": "01HN..."}

event: note:deleted
data: {"id": "01HN..."}
```

Viewer JS subskrybuje → reload lista / note view bez F5.

---

## Bezpieczeństwo

- Bind `127.0.0.1` domyślnie. `--host 0.0.0.0` wymaga `--auth-token`.
- CSP w viewerze: `default-src 'self'; script-src 'self' 'unsafe-inline'` (inline JS w sidebarze).
- Sandbox dla `<article>` content: w iframe z `sandbox="allow-same-origin"` (bez allow-scripts) gdyby user-content miał JS. Albo strip skryptów przy save → mamy.
- API: token z `~/.config/folio/token`, header `Authorization: Bearer <token>`.

---

## Hot ideas (post-MVP)

- **Multi-pane** layout (lista + preview + edit) jak Obsidian.
- **Command palette** (`Cmd+K`) — szukaj, akcje, jump.
- **Inline AI bubble** — zaznacz fragment → "popraw" → LLM rewrite tylko zaznaczenia.
- **Comments** w trybie multi-user.
- **Theme switcher** (dark / light / sepia) z localStorage.
- **Reader mode** — bez sidebaru, klawiaturowa nawigacja j/k.

---

## Performance budget

- Initial paint < 100ms (server-rendered, cache headers).
- Search response < 50ms dla < 10k notatek.
- Graph render < 500ms dla < 1k nodów.

---

## Dystrybucja

Viewer **jest częścią `folio` binary**. Nie ma osobnej apki. `folio serve` start → user otwiera `localhost:4810`.

Opcjonalna macOS app (Tauri) jako wrapper — post-MVP, nie blokuje.



---

## 🔁 Amendment v3.1 — Viewer UX (2026-05-11)

Po pivocie v3 sekcja "UI components" jest częściowo nieaktualna. Konkretna specyfikacja wizualna w **`mockup-viewer.html`** (w repo) — 4 stany viewera:

1. **Browse (`/`)** — lista chronologiczna z filtrami: typ (Research/Comparison/Technical) i status (Active/Final/Expiring 7d). Liczniki w pillsach. Każdy kafelek pokazuje: typ, tytuł, thread link, czas, snippet, status (final ⭐ / expiring ⏱ / sibling count).
2. **Search (`/search?q=...`)** — FTS5 BM25 z `<mark>` highlights. Score widoczny w MVP, search latency w UI (np. „3 wyniki · 12ms"). Filtry typu nie znikają — zawężanie wyników bez ponownego search'u.
3. **Thread view (`/t/:thread_id`)** — chronologiczny timeline iteracji (v1 → vN). Final wyróżniony zielonym. Actions: Publish (primary), Mark all as final, Archive thread.
4. **Note view (`/n/:id`)** — sidebar 280px z metadanymi + actions + expiring banner z [Finalize] CTA u góry treści. Sidebar wstrzykiwany przez middleware (sam plik niezmieniony — gdy ktoś otworzy bezpośrednio z file://, dostaje czysty content).

**Wycięte z v1 viewer.md:**
- `/tags` tag cloud → backlog (filtry typu wystarczą na MVP)
- `/graph` graph view → KB feature, po pivocie nie pasuje
- `/n/:id/edit` edit view → ADR-014 append-only, brak ręcznej edycji
- "Ask AI to edit" → nie pasuje do append-only

**Dodane (po v3.1):**
- Expiring banner w note view z `[Finalize]` CTA — najmocniejszy reminder w miejscu gdzie user czyta
- Score + match locations w search results (subtle)
- Liczniki w filter pills (Wszystkie 12, Final 4, itd.)
- Implicit publish-as-final w note actions
- Thread view actions: Publish v3 (primary, automatic final), Mark all as final, Archive

**Stack potwierdzony:**
- Server-rendered HTML, Bun.serve, ~200 LOC vanilla JS dla state filter
- Theme.css współdzielony z notatkami (ADR-012 hosted profile)
- Search synchroniczny GET (FTS5 < 10ms)
- SSE `/sse` dla hot reload

**Wizualny styleguide:** plik `mockup-viewer.html` w repo Folio to *jednocześnie* wizualna spec viewera ORAZ referencyjna jakość notatek jakie Skill ma uczyć Ryszarda generować (STYLEBOOK.md kontrakt z S4).
