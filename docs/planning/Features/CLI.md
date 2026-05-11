# 💻 Folio — CLI

> Komenda `folio` to nie tylko user UI — agent też może jej używać (przez `exec`), gdy MCP nie jest podpięte.

---

## Komendy

### Init / config

```
folio init [--root ~/Folio]
folio config get <key>
folio config set <key> <value>
folio doctor              # sprawdza setup (sqlite ok? templates wczytane? port wolny?)
```

### Tworzenie

```
folio new "<title>" [--type comparison|research|journal|technical|snippet]
                    [--tags tag1,tag2]
                    [--from <url>]                 # pobiera URL, pcha do template'u
                    [--content @file.html]         # albo z pliku
                    [--prompt "..."]               # albo LLM wygeneruje (wymaga API key)
                    [--open]                       # open w macOS po stworzeniu
                    [--accent <#hex>]              # override koloru wiodącego

folio quick "<text>"      # snippet 1-linijkowy, default tagging
```

### Read / Browse

```
folio list [--type T] [--tag X] [--since 7d] [--limit 50] [--json]
folio search "<query>" [--type T] [--tag X] [--limit 20] [--json]
folio show <id|slug>       # podgląd metadanych w terminalu
folio open <id|slug>       # `open` w macOS (default browser)
folio cat <id|slug>        # body_html do stdout (pipe-able)
folio recent [N]           # ostatnie N
```

### Update

```
folio edit <id>            # otwiera plik w $EDITOR
folio rename <id> "<new title>"
folio retype <id> <new-type>     # zmienia typ → re-renderuje przez nowy template
folio append <id> @file.html     # dopisuje na końcu <article>
folio rewrite <id> "<instr>"     # LLM-powered rewrite z instrukcją
```

### Tagi / Linki

```
folio tag <id> +tag1 -tag2
folio tags                 # lista wszystkich tagów + counts
folio link <id-a> <id-b> [--rel related]
folio unlink <id-a> <id-b>
folio links <id>           # pokaż out- i in-links
```

### Delete / Restore

```
folio delete <id>          # soft delete → .trash/
folio delete <id> --hard
folio trash list
folio restore <id>
folio empty-trash
```

### Maintenance

```
folio reindex              # full rescan plików → SQLite
folio backup [--out <path>]
folio restore-backup <zip>
folio export <id> [--format html|md|pdf] [--out <path>]
folio import <path>        # md/html → folio note (best-effort)
```

### Server / MCP

```
folio serve [--port 4810] [--host 127.0.0.1]
folio mcp                  # uruchamia stdio MCP server (do podpięcia w Claude Desktop)
folio mcp --http           # HTTP transport
```

### Diagnostyka

```
folio stats                # ile notatek, jaki rozmiar, top tagi
folio version
folio path                 # wypisuje storage root
```

---

## Output formats

- Default: kolorowy, human-readable.
- `--json` — strukturalny output (dla skryptów i agentów).
- `--plain` — surowy tekst, bez kolorów (do pipowania).

Przykład:

```
$ folio search "obsidian" --json
[
  {
    "id": "01HN8QF7...",
    "slug": "obsidian-vs-affine-vs-trilium",
    "title": "Obsidian vs Affine vs Trilium",
    "type": "comparison",
    "created": "2026-05-11T00:17:00Z",
    "score": 8.94,
    "snippet": "...Obsidian to <mark>markdown</mark>-first..."
  }
]
```

---

## Implementacja

- Lekki router: handlowane przez parsowanie `process.argv` (bez Commander, ~200 linii) ALBO `commander` jeśli urosną opcje.
- Każda komenda = osobny moduł w `src/cli/commands/<name>.ts`.
- Wspólny core: `src/core/{storage,search,templates,llm}.ts`.
- Output: helper `src/cli/io.ts` z `print`, `printJson`, `printError`, `withSpinner`.

---

## Exit codes

- `0` — sukces
- `1` — generic error
- `2` — nie znaleziono notatki
- `3` — błąd walidacji argumentów
- `4` — błąd I/O (uprawnienia, dysk pełny)
- `5` — błąd LLM (timeout, brak klucza)

---

## Shell completion

- bash / zsh / fish — wygenerowane przez `folio completion <shell>`.
- Tab-complete dla ID/slug (czyta z SQLite).

---

## Konfiguracja LLM (dla `--prompt` / `rewrite`)

```jsonc
// ~/.config/folio/folio.config.json
{
  "llm": {
    "provider": "anthropic",     // anthropic | openai | openrouter | local
    "model": "claude-sonnet-4-7",
    "api_key_env": "ANTHROPIC_API_KEY",
    "max_tokens": 4000
  }
}
```

Brak klucza → komendy LLM zwracają exit 5 z friendly hintem.

---

## DX (developer experience)

- Stderr dla logów, stdout dla danych (pipe-friendly).
- Sygnały: SIGINT czyści lockfile, zamyka DB.
- Globalne `--verbose` / `--quiet` / `--debug`.
- `FOLIO_HOME=/path` override storage root.
