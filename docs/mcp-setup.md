# Folio MCP Server — setup dla agentów

`folio-mcp` to stdio MCP server udostępniający 8 tools agentom: `folio.create`, `folio.get`, `folio.list`, `folio.search`, `folio.finalize`, `folio.suggest_thread`, `folio.list_expiring`, `folio.list_themes`.

## Sprawdzenie smoke testem

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | bun /Users/jarek/Projects/Folio/bin/folio-mcp.ts
```

Powinno zwrócić JSON-RPC response z listą 8 tools.

## Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```jsonc
{
  "mcpServers": {
    "folio": {
      "command": "bun",
      "args": ["/Users/jarek/Projects/Folio/bin/folio-mcp.ts"],
      "env": {
        "FOLIO_HOME": "/Users/jarek/Folio"
      }
    }
  }
}
```

Po restarcie Claude Desktop powinien widzieć `folio.*` tools.

## OpenClaw / Claude Code

Plugin `mcporter` lub natywna integracja:

```bash
claude mcp add folio bun /Users/jarek/Projects/Folio/bin/folio-mcp.ts
```

## Cursor / Continue

Większość klientów MCP czyta podobny config. Komenda: `bun /Users/jarek/Projects/Folio/bin/folio-mcp.ts`. Brak args. Env: `FOLIO_HOME` (opcjonalne, default `~/Folio`).

## Konwencja odpowiedzi agenta

Po `folio.create` Folio zwraca pole `response_hint` sugerujące:

```
MEDIA:http://127.0.0.1:4810/n/<id>
<3-5 linijek TL;DR>
```

User dostaje link do otwarcia w przeglądarce + krótkie streszczenie w czacie. To jest core UX pętli Folio.

## Recommended flow per agent prompt

1. **Dispatch decyzja:** czy to zadanie wymaga rich artefaktu (research, comparison, technical) czy short reply? Jeśli short → odpowiedz tekstem. Jeśli rich → Folio.
2. **Pre-create:** `folio.suggest_thread({ title })` — jeśli matching thread istnieje, użyj jego `thread_id`. Jeśli nie, użyj proposed slug.
3. **(Opcjonalnie) `folio.list_themes`** — jeśli kontekst sugeruje specyficzny theme (formal report → newsroom, system spec → terminal).
4. **`folio.create`** z theme + thread_id + body_html zgodnym z stylebook'iem aktualnego theme'u.
5. **Odpowiedź** z `MEDIA:<local_url>` + TL;DR.
6. **Po `folio.publish`** (kiedyś, S6): `folio.list_expiring` żeby zaproponować finalizację innych not w threadzie. Tylko w Folio-related convo (ADR-019 gating).

## Bezpieczeństwo

- Stdio transport, lokalne IPC, no network.
- Folio sanityzuje `body_html` allowlistem (sanitize-html) — `<script>` blocked.
- Pliki HTML lądują w `$FOLIO_HOME` (default `~/Folio`). Sprawdź uprawnienia.

## Debug

Jeśli MCP nie startuje:

```bash
bun /Users/jarek/Projects/Folio/bin/folio-mcp.ts 2>&1
# Zobaczysz stderr; stdout jest dla JSON-RPC, nie loguj tam.
```

`FOLIO_DEBUG=1` włącza extra stack traces.
