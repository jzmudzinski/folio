# Folio viewer — redesign v2

Brief: `docs/design-brief-viewer-v2.md`.

## Pliki

| Plik | Co to |
|---|---|
| `index.html` | **Główny mockup.** Wszystkie 4 stany jako sekcje przełączane przyciskiem w prawym dolnym rogu. Jeden plik = wygodne side-by-side porównanie + 1:1 z tym co finalnie chrome ma być (jedna trasa serwera, server-rendered HTML). |
| `redesign-list.html` `redesign-search.html` `redesign-threads.html` `redesign-note.html` | **Per-route stuby** dla zgodności z brief'em (deliverable #1). Każdy ładuje `index.html#<route>`, więc edytujesz jedno źródło. |
| `viewer.css` | Wyciągnięty CSS — to co trafia do `src/viewer/render.ts` jako `VIEWER_CSS` const. Diff vs obecny: ~+250 linijek, ~–80, głównie nowe primitywy (`.hero`, `.cluster`, `.thread-card .progress`, `.action-card`, `.note-side` dłuższe). |

Mobile responsive jest wbudowane (media query `860px`); zwęź viewport żeby zobaczyć.

## System (krótko)

- **Wide chrome / narrow content.** Top-bar i listy idą na `1400px` max, kolumna czytania w note view na `720px`. Załatwia pain #2 — nie ma więcej "uciętej kartki" pośrodku 1600px ekranu.
- **Typo hierarchia jest prawdziwa.** Familjen Grotesk 500 robi 4 levele (hero 52px / row title 18px / sidebar h1 24px / cluster h3 22px) zamiast jednego `font-size: 14px` wszędzie. Instrument Serif italic jako lead/snippet — żywe, editorial.
- **Mono tylko na technicalia.** JetBrains Mono = thread_id, daty, słownictwo "tagi", scores, kbd. Nigdy w nagłówkach ani CTA.
- **Orange dyscyplinowany.** Pomarańcz tylko na: dot kropki w wordmarku, primary CTA, ★ final, hover akcent, `<mark>` w snippet. Nie maluję nim całych badge'y.
- **Ink jako primary.** Czarne `--vink` to "ważne" — primary CTA card jest czarna, nie pomarańczowa (orange to hover state). Kontrast z kremowym tłem dźwiga ciężar.

## Decyzje per stan

### `/` — lista (pain #1: "lista nieczytelna")
- **Hero card** dla najnowszej noty: 52px Familjen Grotesk + Instrument Serif italic lead + meta-line. Buduje od razu hierarchię "to jest ważne".
- **Rows ~48px** z 4 kolumnami: type label (kolor zamiast pigułki, bardziej redakcyjnie), title + sub-line (thread + theme/słowa), age, status. Hover daje 2px orange spine z lewej + tinted background.
- **Group labels** są thin ALL-CAPS mono z dłuższym divider, plus akcent serif italic ("świeże" / "w toku") — odróżnia "Dzisiaj" od "W tym tygodniu" tonalnie, nie tylko strukturalnie.
- Filtry: pomarańczowe pill'e wymienione na **ink-fill on active** (mocniejszy "jest wybrane"), warn nadal amber.

### `/search` (pain #4: wątki vs noty wyglądają tak samo)
- **Dwa różne primitywy.** Wątki = `.cluster` card z orange spine z lewej, mini "stack of chips" pokazujący wszystkie wersje not w wątku + duża cyfra "5 not" po prawej. Noty = ten sam `.row` co na liście, plus `.snippet` w Instrument Serif italic.
- Snippet jest serif italic + `<mark>` w pomarańczowym tle, czyta się jak cytat z artykułu.
- Score zostaje, ale przesunięty do kolumny "age" — score to ★ N.N (mniej krzyczy niż osobna kolumna).

### `/threads` (rewizja)
- **Spine metaphor.** Każdy thread-card ma cienką pionową linię z lewej (var(--vline)) która na hover zmienia się w orange — wizualnie sugeruje "to jest oś czasu, kontynuacja".
- **Progress ticks.** Mini ticki (18×4px) pokazują wszystkie wersje w wątku, final jako orange tick. W jednym rzucie oka widzisz "wątek 5 wersji, final w v5" vs "wątek 8 wersji, brak final".
- Duża cyfra count (28px Familjen) zamiast "5 notatek" w tekście — szybkie skanowanie.

### `/n/:id` (pain #3: sidebar ciężki, akcja tonie)
- **Sidebar 248px** (z 280px) — schudł.
- **Action card jako pierwsza rzecz po tytule.** Czarna karta, 14px padding, hover→orange. "Mark as final" z primary-action eyebrow + hint linia ("Zatrzymaj auto-delete · zarchiwizuj…"). Wygląda jak feature, nie buton w stopce.
- **Side meta to `<dl>`** z mono labels (ALL-CAPS 9.5px) i values po prawej w mono 12px — zbity, czytelny grid, nie luźno rozrzucone div'y. Tagi w osobnym rzędzie jako chip'y.
- **Aux nav** (raw HTML, export, share, delete) wypchnięty na dół jako lekkie text-linki mono, nie buttony — odbarwione, nie konkurują z primary.
- Banner "Auto-delete za 30d" z subtelnym amber gradient i drugą instancją finalize button (po prawej) — żeby user nie musiał celować w lewą kolumnę.
- Reading column w panelu (`--vpanel` #fdfcf9) z auto-marginesem do 720px — chrome szerokie, treść wąska.

## Motion (pain #5)
Drobne, nie SaaS-y. Wszystko w `transition: <prop> .12s–.15s`:
- Filter pill: kolor + border na hover, `translateY(1px)` na :active.
- Row: 2px orange spine sliduje z lewej (przez `::before`).
- Hero: arrow przesuwa się o 8px + zmienia kolor na orange.
- Cluster: lekkie `translateY(-1px)` na hover.
- Search input: orange ring (`box-shadow 0 0 0 4px`).

JS minimalne (~30 LOC) tylko: route switcher w prototypie, `/` shortcut żeby focusować search.

## Mobile (pain #6)
Próg `860px` (nie `720px` — między phone a tablet). Co się dzieje:
- Top bar wraps; nav schodzi na drugą linię.
- Filter strip scroll'uje się poziomo z fade indicator.
- Hero traci arrow + zmniejsza tytuł do 32px.
- Rows tracą kolumnę "age" (zostaje w sub-line) i pozwalają tytułowi się zawijać.
- Cluster idzie single-column; cluster-meta przechodzi z prawej kolumny na inline pod blurb.
- Note shell schodzi do single column — sidebar najpierw, potem reading.

## Co celowo NIE zostało zrobione
- **Nowy wordmark/lockup** — pozostaje v08 (Familjen 500 + thin div + JetBrains Mono tagline).
- **Treść `<article>`** — w mockup'ie jest placeholder w stylu linen theme, ale w prod iframe nadal renderuje theme'y bez zmian.
- **Stats page** — poza scope (nie w pain'ach).
- **Drag-reorder / inline edit** — out of scope, nie było w brief'ie.

## Iteracja
Mockup ma route switcher na dole — klikaj między `/`, `/search`, `/threads`, `/n/:id`. Daj feedback per stan i lecimy z v3.
