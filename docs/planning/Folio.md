# 📄 Folio — Visual Communication Layer for AI ↔ Humans

> Markdown nie wystarcza jako medium komunikacji od agentów. Folio = wspólna powierzchnia HTML między dowolnym agentem a tobą.

**Codename:** Folio
**Repo:** `/Users/jarek/Projects/Folio`
**Stack:** Bun + TypeScript + SQLite (FTS5) + plain HTML/CSS + MCP SDK + Cloud publish (opt-in)
**Status:** 🟡 Planning v3 — **Pivot refined 2026-05-11**
**Powiązane:** [[Architecture]] · [[TODO]] · [[Changelog]] · [[Decisions]]

> **Pivot v3 (2026-05-11):** Folio jest **append-only**. Agenty wyłącznie *tworzą* nowe dokumenty HTML, nigdy nie edytują istniejące. Iteracje tego samego tematu lądują w jednym folderze (thread). Stare nieoznaczone noty auto-czyszczą się po 30 dniach; persistencja = opt-in „final" marker.

---

## 🎯 Elevator Pitch

Agent (Claude / Cursor / Ryszard / GPT) ma ci coś przekazać. Dziś dostajesz markdown w terminalu/czacie — flat hierarchy, brak scorecardów, sidebarów, color-coded findings, in-page nav.

Folio = **wspólna komunikacyjna powierzchnia HTML**:
1. Agent woła `folio.create` przez MCP → ląduje plik w `~/Folio/threads/<topic>/<id>.html`.
2. Agent w odpowiedzi: link `http://localhost:4810/n/<id>` — otwierasz w przeglądarce.
3. Czytasz wizualnie bogaty artefakt.
4. Chcesz inną wersję? Mówisz agentowi → `folio.create` z tym samym `thread_id` → **nowy dokument obok poprzedniego** w tym samym folderze.
5. Przeglądasz warianty, oznaczasz najlepszy jako „final" (zostaje na zawsze). Reszta auto-czyści się po 30 dniach.
6. Chcesz pokazać Magdzie? `folio.publish` → `folio.app/<user>/<slug>` z OG screenshotem dla rich preview.

**Nie KB. Komunikacja.** Folio nie jest tym co pamiętasz za rok — tym co teraz omawiasz z agentem (chyba że oznaczysz inaczej).

---

## 💡 Problem → Rozwiązanie

### Problem
- Markdown ma flat hierarchy. Brak diagramów, scorecardów, color-coding, in-page nav.
- Claude Artifacts żyją w Claude UI — agent-locked, nie wpinasz w workflow.
- Notion AI = Notion-locked block format, niestandalone.
- Loom = wideo, async, brak refactor cyklu przez konwersację.
- Brak medium gdzie *dowolny* agent z MCP daje bogaty artefakt, lokalnie konsumowany i opcjonalnie shareowany.

### Rozwiązanie
- **Format:** standalone HTML (Thariq pattern).
- **Local-first:** serwer Bun pokazuje wszystko z `~/Folio/`.
- **MCP-native:** każdy klient MCP — wyłącznie CREATE.
- **Append-only model:** zero edit; chcesz inaczej → nowy dokument w tym samym threadzie.
- **Thread folders:** powiązane dokumenty w jednym folderze, user przegląda i wybiera (ADR-014).
- **Final marker:** ważne noty zostają; reszta auto-trash po 30d (ADR-015).
- **FTS5 + text extraction:** smart search po title/headings/body z field weighting; bez markdown shadow (ADR-016).
- **Analytics od S1:** mierzymy realnie 50% token savings z ADR-012 + lifecycle metrics (ADR-017).
- **Cloud publish (opt-in):** `folio.app/<user>/<slug>` + OG screenshot dla rich previews (ADR-018).

---

## ✨ Pozycjonowanie

| | Claude Artifacts | Notion AI | Loom | Obsidian | **Folio** |
|---|---|---|---|---|---|
| Medium | HTML w iframe | MD/blocks | Wideo | MD plików | **Standalone HTML** |
| Agent-agnostic | ❌ Claude only | ❌ Notion only | n/a | ❌ | ✅ Każdy MCP klient |
| Local-first | ❌ | ❌ | ❌ | ✅ | ✅ |
| Share via URL | ❌ (export only) | ✅ | ✅ | ❌ | ✅ opt-in + OG preview |
| Wizualna jakość | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ |
| Edit cycle | replace whole | block edit | n/a | manual | **append-only (nowa wersja)** |
| Auto cleanup | ❌ | ❌ | ❌ | ❌ | ✅ 30d non-final |

---

## 🏗️ Stack

| Warstwa | Tech | Notatka |
|---|---|---|
| Runtime | Bun + TS | Szybki start, native sqlite |
| Storage | SQLite (FTS5) + HTML pliki | Plain-text z HTML do indexu (ADR-016) |
| MCP | `@modelcontextprotocol/sdk` | stdio + opt. HTTP |
| Templates | Eta light + theme.css | Dwa profile renderu (ADR-012) |
| Local viewer | Bun HTTP server (`folio serve`) | Główne UI |
| Cloud publish | Cloudflare Pages / Vercel + edge | Osobny projekt (S6) |
| Analytics | SQLite tabela `events` | Token count, class match rate, lifespan (ADR-017) |

---

## 🎬 Demo flow

```
USER (czat z agentem):
    "Przygotuj research o RAG vs fine-tuning"

AGENT:
    folio.create({
      type: "research",
      title: "RAG vs Fine-Tuning",
      body_html: "...",
      thread_id: "rag-vs-finetuning",       // agent wybiera albo woła folio.suggest_thread
      theme_profile: "hosted"               // mniej tokenów
    })
    → { id, local_url: "http://localhost:4810/n/01HN..." }

AGENT (odpowiedź):
    "✓ http://localhost:4810/n/01HN..."

USER (otwiera URL, czyta):
    "Hmm, cost analysis za płytkie. Zrób z konkretnymi cenami i case studies"

AGENT (bez edycji — nowy dokument):
    folio.create({
      type: "research",
      title: "RAG vs Fine-Tuning — Cost Deep Dive",
      body_html: "...",
      thread_id: "rag-vs-finetuning"
    })
    → { id, local_url, thread_siblings: [<v1_id>] }

USER (viewer pokazuje thread folder z 2 dokumentami):
    [czyta v2, klika „Mark as final" w sidebarze]
    → v2 ma is_final=true (nie wyczyści się)
    → v1 zostanie soft-deleted po 30 dniach (banner: „auto-cleanup za 28 dni")

USER:
    "Wyślij to Magdzie i Łukaszowi"

AGENT:
    folio.publish({ id: v2_id, audience: ["magda@…", "lukasz@…"] })
    → { url: "https://folio.app/jarek/rag-vs-finetuning-cost-deep-dive" }
    → background: cloud worker renderuje screenshot top-of-page → OG image dla
      Telegram/Slack/iMessage rich preview
```

---

## 🚀 Sprint plan v3

| Sprint | Cel | Status |
|---|---|---|
| **S0** | Pivot decisions + repo init | 🟡 |
| **S1** | Storage + viewer + `folio.create` + text extraction + FTS index + analytics | ⬜ |
| **S2** | Templates + theme + 3 typy + dwa profile renderu | ⬜ |
| **S3** | MCP server: create, get, list, search, finalize, suggest_thread | ⬜ |
| **S4** | OpenClaw Skill + flow examples + thread heuristics | ⬜ |
| **S5** | Lifespan + auto-cleanup + final marker UX | ⬜ |
| **S6** | Cloud publish (folio.app) + OG screenshot | ⬜ |
| **S7** | Polish + mobile + open source | ⬜ |

- **MVP komunikacja:** S1+S2+S3+S4.
- **MVP persistence model:** S5.
- **MVP share:** S6 (osobny projekt — nie blokuje).

Detale → [[TODO]]. ADR-y → [[Decisions]].

---

## 📝 Open questions

- [ ] Nazwa finalna: Folio? (sprawdzić folio.app / folio.dev dostępność)
- [ ] Subdomain layout: `folio.app/<user>/<slug>` (path) vs `<user>.folio.app/<slug>` (subdomain)?
- [ ] Auth cloud: GitHub OAuth + magic link?
- [ ] Thread_id source: agent sam wymyśla, czy `folio.suggest_thread` jest *wymagane* przed create?
- [ ] Default lifespan tunable (30d) per-user? per-thread? per-typ noty?
- [ ] Co z notami bez `thread_id`? Bucket `notes/YYYY/MM/` (dzienny), czy `threads/loose/<id>/`?
- [ ] Final marker — czy agent może markować autonomicznie („to jest dobra wersja" → folio.finalize), czy tylko user?



---

## 🔁 Amendment v3.1 (2026-05-11 evening)

Domknięte open questions:
- ✅ **Thread_id source:** opcja B — `folio.suggest_thread` jest mandatory przed `folio.create` (Skill enforce).
- ✅ **Loose notes:** nie ma. Każda nota ma thread; brak `thread_id` → Folio sam tworzy slug z tytułu. Daily bucket usunięty.
- ✅ **Final marker UX:** `folio.publish` automatycznie ustawia `is_final=true` (implicit final on publish). User nie musi pamiętać o oznaczaniu, jeśli już shareował.

Nowe:
- **`folio.list_expiring` MCP tool** — Skill może proaktywnie sprawdzać wygasające noty (ADR-019).
- Surfacing gated reguł żeby Skill nie był Clippy.
