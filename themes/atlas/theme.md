# Theme: Atlas

Academic paper aesthetic — Crimson Pro serif, small-caps section heads, drop cap on the opening paragraph, hairline rules around tables. Burgundy + ochre + ink-blue accents. Reads like a peer-reviewed journal you'd actually want to read.

## Voice

Measured, third-person where natural, hedged but not weak. Prefer "we observe" over "I think". Cite numbers, name your method, name your data window. Footnoting tone — every claim provable.

## Structure

- Lead as 1-2 sentences in italic serif. This is the abstract — describe the question and the result.
- The first paragraph gets a drop cap (CSS-driven). Write it with that in mind — the first word should not be a conjunction.
- Following paragraphs are indented — write prose, not lists. 4-8 sentences per paragraph.
- H2 are numbered sections (the theme renders small-caps), H3 are mono caps mini-markers.
- Tables and code blocks break out of the prose column — use them when the data speaks better.

## Typography

- Headings: **Crimson Pro** 500
- Body: **Crimson Pro** regular 18px
- Mini-heads (H3): **Inter** caps tracking
- Code/data: **JetBrains Mono**

## Classes

- `.eyebrow` — category + discipline ("Research · Retrieval systems")
- `.lead` — italic serif abstract, 1-2 sentences
- `.pill` — `.good`/`.bad`/`.mid`/`.acc`/`.info`, a mono caps badge
- `.cards` — grid for figure-like comparisons
- `.verdict` — closing paragraph with an accented top border; this is where "implications" / "limitations" go

## Avoid

- Emoji. Atlas is a scientific journal, not a thread.
- Exclamation marks, "obviously", "clearly", "of course".
- Marketing slop ("revolutionary", "leverages", "seamlessly").
- Bullets everywhere — this isn't a deck, write prose.
- ALL CAPS — small caps are handled in CSS, keep the HTML clean.

## Best for

Scientific reports, structured analyses with data, literature reviews, formal research notes someone might actually cite. Anything where authorship and method are part of the argument.
