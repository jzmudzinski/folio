# Recipe example

**User prompt:**

> Zapisz mi przepis na spaghetti aglio e olio

**Agent action sequence:**

1. `suggest_thread({ title: "Spaghetti aglio e olio" })` → empty → use `spaghetti-aglio-e-olio`
2. `create({ type: "recipe", title: "Spaghetti aglio e olio", thread_id: "spaghetti-aglio-e-olio", tags: ["kuchnia","makaron"], recipe: <payload.json> })`
   — note: **no `body_html`**; the server renders the responsive layout from the `recipe` data.
3. Respond with `MEDIA:<public_url>` + a 2–3 line TL;DR.

The `recipe` payload sent in step 2 is in [`payload.json`](payload.json). Key points it demonstrates:

- Flat ingredient list (one group, no `group` name).
- Numeric `qty` on the scalable items; a string `qty` ("do smaku") on the one that has no real amount.
- `meta.servings` with a leading number ("2 porcje") so the servings scaler works.
- `cook_time` is fine for a dish; drinks would use `glass` / `method` / `abv` instead.
