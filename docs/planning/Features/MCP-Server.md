# 🔌 Folio — MCP Server

> Model Context Protocol server: agent → Folio tools.

---

## Cel

Każdy klient MCP (Claude Desktop, Cursor, OpenClaw, OpenCode, Continue, …) może podłączyć się do Folio i robić CRUD + search nad notatkami **przez ustandaryzowany interfejs**.

---

## Transport

- **Default:** stdio (binary `folio-mcp` startuje per-session, agent łączy się przez pipe).
- **HTTP (opt-in):** gdy `folio serve` chodzi, MCP wystawione na `http://127.0.0.1:4810/mcp` (z auth header z `~/.config/folio/token`).

---

## Tool catalog

### `folio.create`

Tworzy nową notatkę.

```ts
input: {
  type: "comparison" | "research" | "journal" | "technical" | "snippet" | "custom",
  title: string,                            // human-readable
  body_html?: string,                       // sanitized HTML do wrzucenia
  body_markdown?: string,                   // alternatywa — Folio zrenderuje
  prompt?: string,                          // jeśli ani html ani md → Folio prosi sub-LLM o wygenerowanie z template
  tags?: string[],
  links?: { dst_id: string, rel?: string }[],
  template_overrides?: Record<string, any>, // np. accent color, kolejność sekcji
  open?: boolean                            // default false; gdy true → `open` w macOS
}
output: {
  id: string,           // ULID
  slug: string,
  path: string,         // absolutny
  url: string,          // file:// lub http://localhost:4810/n/<id>
  created: string
}
```

**Notes:**
- Sanityzacja `body_html` zawsze.
- `links` powodują **bidirectional** wpis (linkujemy z A do B → backlink B→A automatycznie).

### `folio.search`

```ts
input: {
  query: string,
  limit?: number,         // default 20, max 100
  tags?: string[],
  type?: string,
  since?: string,         // ISO date
  until?: string
}
output: Array<{
  id: string,
  slug: string,
  title: string,
  type: string,
  created: string,
  updated: string,
  snippet: string,        // FTS5 snippet z highlightem
  score: number,          // BM25
  tags: string[]
}>
```

### `folio.get`

```ts
input: { id: string, format?: "html" | "text" | "metadata" }
output: {
  id: string,
  metadata: { title, type, created, updated, tags, links, word_count, summary },
  body_html?: string,
  body_text?: string
}
```

`format: "metadata"` → bez body (lekkie listowanie).

### `folio.update`

```ts
input: {
  id: string,
  mode: "replace" | "append" | "prepend" | "patch",
  body_html?: string,         // dla replace/append/prepend
  patch?: {                    // dla "patch"
    selector: string,          // CSS selector wewnątrz <article>
    operation: "replace" | "insertBefore" | "insertAfter" | "remove",
    content?: string
  },
  title?: string,
  tags_add?: string[],
  tags_remove?: string[]
}
output: { id: string, updated: string, version: number }
```

**Wersjonowanie:** każda mutacja → snapshot do `.versions/<id>/`. Patrz ADR-008.

### `folio.list`

```ts
input: { tag?: string, type?: string, since?: string, limit?: number, sort?: "created" | "updated" | "title" }
output: Array<{ id, title, type, created, updated, tags }>
```

### `folio.link`

```ts
input: { src_id: string, dst_id: string, rel?: "related" | "cited" | "follow_up" | "supersedes" | string }
output: { ok: true, src_id, dst_id, rel }
```

### `folio.tag`

```ts
input: { id: string, add?: string[], remove?: string[] }
output: { id: string, tags: string[] }
```

### `folio.delete`

```ts
input: { id: string, soft?: boolean }   // soft = move do `.trash/`, hard = unlink
output: { ok: true, id }
```

### `folio.suggest_links` *(advanced, S7)*

```ts
input: { id: string, top?: number }      // FTS + (opt.) embeddings
output: Array<{ candidate_id, title, score, why: string }>
```

---

## Resources (MCP `resources/`)

Folio może wystawiać też **resources** (nie tylko tools):

- `folio://note/<id>` — pełny HTML notatki, agent może `read_resource` żeby załadować do kontekstu.
- `folio://list?tag=X` — JSON listy.
- `folio://recent` — top 20 ostatnich.

Pomysł: agent może zapytać „daj mi wszystkie notatki o RAG" → dostaje resource'y do kontekstu zanim odpowie userowi.

---

## Prompts (MCP `prompts/`)

Predefiniowane prompty agentowi:

- `folio:write-comparison(items: string[], criteria?: string[])` — gotowy prompt do wygenerowania notatki typu comparison ze stylebookiem.
- `folio:write-research(topic: string, depth: "shallow"|"deep")` — research note.
- `folio:summarize-url(url: string)` — pobierz URL → notka research z summary + key takeaways.
- `folio:journal-entry(mood?: string)` — journal template z datą.

Agent może je zacytować w swojej rozmowie, dostaje konkretne instrukcje generowania.

---

## Configuration

```jsonc
// ~/.config/folio/mcp.json
{
  "transport": "stdio",       // lub "http"
  "http_port": 4810,
  "auth_token": "<random>",
  "storage_root": "~/Folio",
  "log_level": "info",
  "rate_limit": { "create_per_minute": 30 }
}
```

---

## Claude Desktop / OpenClaw setup

```jsonc
// ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "folio": {
      "command": "folio-mcp",
      "args": []
    }
  }
}
```

OpenClaw: rejestrujemy via `mcporter` (skill openclaw-skills:mcporter umie).

---

## Bezpieczeństwo

- Stdio: ufamy procesowi rodzicowi (claude desktop / openclaw).
- HTTP: bind do 127.0.0.1, wymagany `Authorization: Bearer <token>`, token w `~/.config/folio/token` (chmod 600).
- Sanitize HTML zawsze przed zapisem.
- Rate limit `folio.create` żeby nie zalać dysku.

---

## Testing

- `bun test` z mock MCP client (own helper) → smoke testy każdego toola.
- E2E: spawn `folio-mcp`, client wykonuje sekwencję `create → search → get → update → delete`, asercja.
