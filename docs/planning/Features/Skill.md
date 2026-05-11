# 🎓 Folio — OpenClaw Skill

> Skill jest cienki: mówi agentowi *kiedy* i *jak* używać MCP toolsów, nie zawiera logiki.

---

## Lokalizacja

`~/.openclaw/workspace/skills/folio/SKILL.md`

Albo (gdy publish jako oficjalny skill): `~/Library/pnpm/global/.../openclaw/skills/folio/SKILL.md`.

---

## Frontmatter (proposal)

```yaml
---
name: folio
description: |
  Tworzenie estetycznych HTML-owych notatek przez Ryszarda do osobistej bazy wiedzy Jarka.
  Używaj gdy Jarek prosi o porównanie, research, streszczenie, notatkę, zapisanie czegoś
  do "Folio", "bazy wiedzy", "drugiego mózgu HTML-owego". Także proaktywnie po dłuższych
  rozmowach (researche, decyzje, debriefe) — zaproponuj zapis do Folio.
homepage: <repo url>
metadata:
  openclaw:
    emoji: "📄"
    requires:
      bins: ["folio"]
      mcp: ["folio"]
---
```

---

## Treść (szkic SKILL.md)

```markdown
# Folio Skill

## Kiedy używać

Triggery (PL/EN):
- "porównaj X i Y", "compare X vs Y"
- "research [temat]", "rozszerz / streść"
- "zrób mi notatkę o ...", "zapisz to do folio", "do bazy wiedzy"
- "TL;DR ten artykuł / URL"
- "dziennik z dzisiaj" (technical journal — nie interstitial)

Proaktywnie:
- Gdy w rozmowie wyprodukowałeś dłuższy artefakt (porównanie, research, ADR) → zaproponuj zapis: "Zapisać do Folio jako [typ]?"
- Po debriefach (rozmowa rekrutacyjna, meeting) → zaproponuj typ `journal`.

NIE używaj gdy:
- To zwykła odpowiedź konwersacyjna ("która godzina?")
- User prosi o edycję istniejącego pliku poza Folio
- To temat dla Obsidiana ręcznego (Daily notes, projekty zarządzane manualnie)

## Wybór template'u

| Sygnał w prompcie | Template |
|---|---|
| "porównaj", "vs", "różnice między" | `comparison` |
| "research", "deep dive", "wszystko o" | `research` |
| "co dziś", "debrief", "podsumowanie dnia" | `journal` |
| "ADR", "decyzja techniczna", "specyfikacja" | `technical` |
| "zapisz to", krótka notka, fragment | `snippet` |

Gdy niejasne → spytaj jednym pytaniem albo wybierz `research` jako safe default.

## Jak generować body_html

### Stylebook (kontrakt z theme.css)

- Używaj wbudowanych klas: `.eyebrow`, `.tag`, `.pill {.good|.mid|.bad}`, `.card`, `.cards`,
  `.pcCol`, `.verdict`, `.scoregrid`, `.bars`.
- NIE pisz inline `style="..."` poza paroma wyjątkami (bar width, accent kolor).
- NIE używaj surowych `<font>`, `<center>` ani styli z lat 2005.
- Tabele: zawsze `<thead>` + `<tbody>`.
- Sekcje: `<section>` z `<h3 class="section">`.
- Linki zewnętrzne: `target="_blank" rel="noreferrer"`.

### Struktura standardowa

1. `<header>` z `eyebrow` (kategoria) + `<h1>` + `<p class="sub">` (lead, 1-2 zdania).
2. Główna treść w `<section>`-ach.
3. Opcjonalna `<section class="verdict">` z konkluzją / rekomendacją.
4. `<footer>` z datą i ewentualnymi disclaimerami.

### Ton

- Polski domyślnie (Jarek = PL).
- Ryszard: lekko snarky, kompetentny, krótkie zdania.
- Bez korpogówna ("In conclusion", "It is important to note").
- Konkretne liczby > vague stwierdzenia.

## Flow z agentem

```
1. User → prompt
2. Agent decyduje czy to Folio (po triggerach)
3. Agent woła folio.create({ type, title, prompt, tags }) lub generuje body_html ręcznie
4. Folio MCP zwraca { id, path, url }
5. Agent w odpowiedzi:
   - MEDIA:<path>
   - Krótki TL;DR (3-5 linijek)
   - Tag-i / metadane jakie nadał
6. Pamięta id w kontekście (do edycji w follow-upach)
```

## Komendy które agent zna

- `folio.create` — nowa notatka
- `folio.search` — przed pisaniem sprawdź czy nie ma już podobnej; jeśli jest, zaproponuj update
- `folio.get` — załaduj istniejącą do kontekstu zanim ją edytujesz
- `folio.update mode=append` — dopisz sekcję
- `folio.link` — gdy nowa notatka odnosi się do starej, automatycznie zlinkuj
- `folio.list type=X tag=Y` — kontekst projektowy

## Anty-patterny

- ❌ Tworzenie 5 mini-notatek zamiast jednej spójnej.
- ❌ Pisanie HTML-a bez używania theme'u (każda notatka wyglądająca inaczej).
- ❌ Pominięcie metadanych (`tags`, `links`) — utrudnia późniejszy search.
- ❌ Notatka bez `summary` — `folio.list` będzie bezużyteczne.
- ❌ Spamowanie folio.create dla rzeczy, które powinny być w pamięci (memory) lub w czacie.

## Przykłady

### Przykład 1 — Comparison

Prompt: "Porównaj PostgreSQL vs MySQL vs SQLite dla małego SaaS"

```
folio.create({
  type: "comparison",
  title: "PostgreSQL vs MySQL vs SQLite dla SaaS",
  tags: ["databases", "saas", "comparison"],
  prompt: "<oryginalny prompt usera + kryteria>",
  template_overrides: { accent: "#10b981" }
})
```

Body: header + 3 karty (jedna per DB) + tabela funkcji + plusy/minusy + werdykt.

### Przykład 2 — Research

Prompt: "Streszczenie tego artykułu: <URL>"

```
1. fetch URL (web_fetch)
2. folio.create({
     type: "research",
     title: "...",
     tags: ["..."],
     body_html: "<gotowa treść z TL;DR + sections + sources>"
   })
3. odpowiedz z MEDIA + TL;DR
```

### Przykład 3 — Edit istniejącej

Prompt: "Dopisz do tej notatki sekcję o licencjach"

```
1. folio.search "..."  → znajdź id
2. folio.get id        → załaduj
3. folio.update id mode=append body_html="<section>...</section>"
4. odpowiedz: "Dopisałem, nowa wersja: <url>"
```
```

---

## Decyzje implementacyjne dla skilla

- **Plik per typ?** Nie — jeden SKILL.md z wszystkimi typami. Wycinkowe "sub-skille" tylko gdy reguły urosną.
- **Stylebook w pliku osobnym?** Tak — `STYLEBOOK.md` obok SKILL.md, żeby było co linkować z LLM-em jako kontekst.
- **Examples folder:** `skills/folio/examples/` z 4-5 gotowymi prompt→response → agenci mogą few-shot.

---

## Test przed merge

Manualnie zadać Ryszardowi:
1. „Porównaj X i Y" → ma stworzyć comparison.
2. „Zapisz to" po długiej odpowiedzi → ma stworzyć snippet/research.
3. „Dopisz do notatki o Z" → ma wyszukać i update'ować.
4. „Co wiem o Q?" → ma użyć folio.search a nie zmyślać.
5. Krótka odpowiedź typu "co to RAG?" → **nie** ma tworzyć folio (false positive check).
