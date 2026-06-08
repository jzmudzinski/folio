# Recipe notes (`type: "recipe"`, v0.42+)

Folio's first **structured template**. You send compact structured data; the
server renders a responsive, self-contained HTML body (its own CSS + JS travel
inside the note, so it looks right in the viewer, in `/raw`, in exports, and on
a phone when published). **Do not write `body_html` for recipes** — pass the
`recipe` object. One schema covers a cooked dish and a mixed drink.

## Why structured (not HTML)

- **Cheaper** — you emit ~data, not ~3 KB of hand-written HTML.
- **Consistent + responsive for free** — mobile = single column with big tap
  targets; desktop (≥720px) = sticky ingredients rail beside the steps. Tap an
  ingredient to check it off; a servings scaler recomputes quantities (with
  cooking fractions). Print styles included. You don't author any of this.
- **Portable** — CSS/JS are baked into the body, so a shared recipe keeps its
  layout on the recipient's phone.

## The contract

```ts
create({ type: "recipe", title: <dish/drink name>, theme?, tags?, recipe: {
  kind?: "dish" | "drink",        // default "dish"; "drink" shows glass/method/abv
  summary?: string,               // 1–2 sentence intro (rendered as the lead)
  image?: string,                 // relative asset URL from attach_asset (hero)
  meta?: {
    servings?: string | number,   // "4 porcje" / "1 drink" — leading number = scaling base
    prep_time?: string,           // "15 min"
    cook_time?: string,           // dish only
    total_time?: string,
    difficulty?: string,          // "łatwy" / "średni" / "trudny"
    glass?: string,               // drink: "coupe", "tumbler"
    method?: string,              // drink: "shaken" / "stirred" / "built"
    abv?: string,                 // drink: "~22%"
  },
  ingredients: [                  // REQUIRED — array of groups
    { group?: string,             // optional sub-heading; omit for a flat list
      items: [ { qty?: number|string, unit?: string, name: string, note?: string } ] }
  ],
  steps: [ { text: string, time?: string } ],   // REQUIRED — ordered
  equipment?: string[],
  tips?: string[],
  source?: { title?: string, url?: string },
  labels?: { ingredients?, steps?, equipment?, tips?, source?, servings? }  // section-label overrides
}})
```

Only `ingredients` (≥1 group with named items) and `steps` (≥1 with text) are
required. Everything else is optional — a lean recipe stays lean.

### Rules

- **Numeric `qty` wherever real** — `qty: 200` (not `"200"`) lets the servings
  scaler work. Use a string only when there's genuinely no number (`qty: "do smaku"`,
  `qty: "szczypta"`) — it renders as text and isn't scaled.
- **Flat ingredient list** → one group with no `group` name. **Components**
  (dough / filling / sauce; base / garnish) → one group each with a `group` label.
- **Hero image** → `attach_asset` first, then pass the returned **relative** URL
  (`/t/<thread>/asset/<file>`) as `recipe.image`. Never invent an image URL.
- **Labels follow the content language.** Defaults are Polish (`Składniki`,
  `Przygotowanie`, `Wskazówki`, `Sprzęt`, `Źródło`, `Porcje`). For another
  language pass `labels`, e.g. `labels: { ingredients: "Ingredients", steps: "Method" }`.
- **Theme** defaults to `linen` and the layout adapts to any theme. No need to
  call `list_themes` for a recipe.
- **Editing** → `replace({ old_id, recipe: {…} })` with the full (compact) data.
- **Escape hatch** — if a recipe needs something the schema can't express, pass
  `type:"recipe"` with hand-written `body_html` instead; it renders as-is.

## Example — dish

```
create({ type: "recipe", title: "Naleśniki", recipe: {
  kind: "dish",
  summary: "Cienkie, klasyczne naleśniki na słodko lub wytrawnie.",
  meta: { servings: "4 porcje", prep_time: "10 min", cook_time: "20 min", difficulty: "łatwy" },
  ingredients: [
    { group: "Ciasto", items: [
      { qty: 250, unit: "g", name: "mąka pszenna" },
      { qty: 500, unit: "ml", name: "mleko" },
      { qty: 2, name: "jajka" },
      { qty: "szczypta", name: "soli" } ] },
    { group: "Do smażenia", items: [ { qty: 2, unit: "łyżki", name: "masło klarowane" } ] }
  ],
  steps: [
    { text: "Zmiksuj mąkę, mleko, jajka i sól na gładkie ciasto." },
    { text: "Odstaw ciasto na 15 minut.", time: "15 min" },
    { text: "Smaż cienkie naleśniki na rozgrzanej patelni z odrobiną masła." }
  ],
  tips: ["Pierwszy naleśnik zwykle jest próbny — nie zniechęcaj się."]
}})
```

## Example — drink

```
create({ type: "recipe", title: "Dry Martini", recipe: {
  kind: "drink",
  summary: "Klasyk z trzema składnikami, mieszany — nie wstrząsany.",
  meta: { servings: "1 drink", glass: "coupe", method: "stirred", abv: "~30%" },
  ingredients: [{ items: [
    { qty: 60, unit: "ml", name: "gin" },
    { qty: 15, unit: "ml", name: "wytrawny wermut" },
    { qty: 2, unit: "dash", name: "orange bitters" } ] }],
  steps: [
    { text: "Wymieszaj składniki z lodem ok. 20 s.", time: "20 s" },
    { text: "Przelej do schłodzonego kieliszka." },
    { text: "Udekoruj skórką z cytryny." }
  ],
  equipment: ["szklanica barmańska", "baryżka"]
}})
```

Then respond with `MEDIA:<public_url>` + a 2–3 line TL;DR.
