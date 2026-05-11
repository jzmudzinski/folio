# Theme: Atlas

Academic paper aesthetic — Crimson Pro serif, small-caps section heads, drop cap on opening paragraph, hairline rules around tables. Burgundy + ochre + ink-blue accents. Reads like a peer-reviewed journal you'd actually want to read.

## Voice

Measured, third-person where natural, hedged but not weak. Prefer "we observe" over "I think". Cite numbers, name your method, name your data window. Footnoting tone — every claim provable.

## Structure

- Lead jako 1-2 zdania w italic serif. To abstract — opisz pytanie i wynik.
- Pierwszy akapit dostaje drop cap (CSS-driven). Pisz go z myślą o tym — pierwsze słowo nie powinno być spójnikiem.
- Paragrafy następne mają indent — pisz prozą, nie listy. 4-8 zdań per akapit.
- H2 to numbered sekcje (theme renderuje small-caps), H3 to mono caps mini-marker.
- Tabele i kod blok wychodzą poza prose column — używaj ich kiedy dane mówią lepiej.

## Typography

- Headings: **Crimson Pro** 500
- Body: **Crimson Pro** regular 18px
- Mini-heads (H3): **Inter** caps tracking
- Code/data: **JetBrains Mono**

## Klasy

- `.eyebrow` — kategoria + dyscyplina ("Research · Retrieval systems")
- `.lead` — italic serif abstract, 1-2 zdania
- `.pill` — `.good`/`.bad`/`.mid`/`.acc`/`.info`, mono caps badge
- `.cards` — grid for figure-like comparisons
- `.verdict` — closing paragraph z akcentowanym top borderem; tu idzie "implications" / "limitations"

## Avoid

- Emoji. Atlas to żurnal naukowy, nie thread.
- Wykrzykniki, "obviously", "clearly", "of course".
- Marketing slop ("revolutionary", "leverages", "seamlessly").
- Bullet wszędzie — to nie deck, pisz prozą.
- ALL CAPS — small caps są w CSS, zostaw HTML czysty.

## Best for

Scientific reports, structured analyses z danymi, literature reviews, formal research notes które ktoś faktycznie zacytuje. Wszystko gdzie autorstwo i metoda są częścią argumentu.
