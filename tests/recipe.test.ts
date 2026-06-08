import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDb } from "../src/core/db";
import { validateRecipe, renderRecipe } from "../src/core/recipe";
import type { RecipeData } from "../src/core/types";

const DRINK: RecipeData = {
  kind: "drink",
  summary: "Klasyk z trzema składnikami.",
  meta: { servings: "1 drink", glass: "coupe", method: "stirred", abv: "~30%" },
  ingredients: [{ items: [
    { qty: 60, unit: "ml", name: "gin" },
    { qty: 15, unit: "ml", name: "wytrawny wermut" },
    { qty: "do smaku", name: "orange bitters" },
  ] }],
  steps: [
    { text: "Wymieszaj z lodem ~20 s.", time: "20 s" },
    { text: "Przelej do schłodzonego kieliszka." },
  ],
  equipment: ["szklanica", "baryżka"],
};

// ── validation ──────────────────────────────────────────────────────────
test("validateRecipe accepts a complete recipe", () => {
  expect(validateRecipe(DRINK)).toEqual([]);
});

test("validateRecipe rejects missing steps and ingredients", () => {
  expect(validateRecipe({}).length).toBeGreaterThan(0);
  expect(validateRecipe({ ingredients: [{ items: [{ name: "x" }] }], steps: [] }).some((e) => e.includes("steps"))).toBe(true);
  expect(validateRecipe({ ingredients: [{ items: [] }], steps: [{ text: "go" }] }).some((e) => e.includes("ingredients"))).toBe(true);
});

test("validateRecipe rejects a bad kind", () => {
  expect(validateRecipe({ ...DRINK, kind: "cocktailz" as any }).some((e) => e.includes("kind"))).toBe(true);
});

// ── rendering ───────────────────────────────────────────────────────────
test("renderRecipe emits a self-contained, structured fragment", () => {
  const html = renderRecipe(DRINK, "Martini");
  expect(html).toContain("<style>");
  expect(html).toContain("<script>");
  expect(html).toContain('class="r-recipe"');
  expect(html).toContain('data-kind="drink"');
  expect(html).toContain("<h1 class=\"r-title\">Martini</h1>");
  expect(html).toContain('class="r-ings"');
  expect(html).toContain('class="r-steps"');
  // numeric qty is scalable, string qty is not
  expect(html).toContain('data-base="60"');
  expect(html).toContain("do smaku");
  expect(html).not.toContain('data-base="do smaku"');
  // drink-only chip surfaces
  expect(html).toContain("ABV");
  // servings is numeric → scaler mount present
  expect(html).toContain("data-recipe-scale");
});

test("renderRecipe escapes user-supplied HTML", () => {
  const html = renderRecipe({
    ingredients: [{ items: [{ name: "<img src=x onerror=alert(1)>" }] }],
    steps: [{ text: "ok" }],
  }, "T & <b>itle</b>");
  expect(html).toContain("&lt;img src=x");
  expect(html).not.toContain("<img src=x onerror");
  expect(html).toContain("T &amp; &lt;b&gt;itle");
});

test("renderRecipe renders grouped ingredients with sub-headings", () => {
  const html = renderRecipe({
    ingredients: [
      { group: "Sos", items: [{ qty: 2, unit: "łyżki", name: "sojowy" }] },
      { group: "Reszta", items: [{ name: "ryż" }] },
    ],
    steps: [{ text: "krok" }],
  }, "Bowl");
  expect(html).toContain('class="r-group">Sos');
  expect(html).toContain('class="r-group">Reszta');
});

// ── integration: survives sanitize → _base → file ─────────────────────────
let tmpDir: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "folio-recipe-"));
  process.env.FOLIO_HOME = tmpDir;
});
afterEach(() => {
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.FOLIO_HOME;
});

test("recipe body survives sanitize and persists to the .html file", async () => {
  const { init } = await import("../src/cli/commands/init");
  const { createNote } = await import("../src/core/storage");
  expect(await init()).toBe(0);

  const body = renderRecipe(DRINK, "Martini");
  const note = await createNote({ type: "recipe", title: "Martini", body_html: body, thread_id: "drinks", tags: ["drink"] });
  expect(note.type).toBe("recipe");

  const file = readFileSync(join(tmpDir, note.path), "utf-8");
  // The responsive <style> block (with its container query) survives default-mode sanitize.
  expect(file).toContain("@container (min-width:720px)");
  expect(file).toContain(".r-recipe{container-type:inline-size");
  // Progressive-enhancement script + scalable data attributes survive too.
  expect(file).toContain('data-base="60"');
  expect(file).toContain("data-recipe-scale");
  expect(file).toContain("<script>");
});
