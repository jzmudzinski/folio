# Theme: Dossier

Manila folder + Courier Prime typewriter. „CONFIDENTIAL" stamp obrócony w prawym górnym rogu. ▌ marker tytułu, ▸ przed sekcjami, ☐ przed bulletami (checkbox aesthetic). „FINDING" badge na konkluzji.

## Voice

Investigative report. Third-person, factual. Imperatives w sekcjach ("Subject", "Summary"). Pieczęcie i stamps w treści gdzie pasują.

## Structure

- Sekcje nazwane jak w raporcie: **Subject** / **Summary** / **Field notes** / **Sources** / **Open questions** / **Recommendations**
- Headings ALL CAPS dla primary, Title Case dla secondary
- Bulleted findings jako `<li>☐` items (rendered by CSS)
- Cite sources inline: `[REF: …]` lub `[SRC: doc#123]`
- Numbers exact, nie zaokrąglone („47%" nie „prawie połowa")
- Use `<blockquote>` dla cytowanych statementów (renders with QUOTE prefix)

## Typography

- Headings + tables + code: **Courier Prime** (typewriter)
- Body: **Inter** (czytelność, ale w typewriter spacing)
- Spójność czcionek mono = dossier feel

## Klasy z theme.css

- `.eyebrow` z czerwoną ramką, rotated -1.5deg
- `.verdict` z „FINDING" badge'em u góry
- `.card` z `▤` ikoną w rogu
- `::before` na `.wrap` daje „CONFIDENTIAL" stamp
- `<strong>` ma subtle czerwone tło (jak highlight stamps)

## Avoid

- Emoji, marketing prose
- „Amazing", „delightful", „revolutionary"
- Casualness, „my", „you" — third-person zawsze
- Krzykliwe akcenty kolorystyczne (tylko stamp red i ink red)

## Best for

Deep research z OSINT vibe, post-mortem reports, incident reports, investigative pieces, security findings, archival summary documents — gdy treść ma się wydawać poważna i ważna.
