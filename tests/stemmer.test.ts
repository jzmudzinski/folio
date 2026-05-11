import { expect, test } from "bun:test";
import { plStem, plNormalize } from "../src/core/slug";

test("plStem: short base forms preserved", () => {
  expect(plStem("ja")).toBe("ja");
  expect(plStem("dom")).toBe("dom");
  expect(plStem("on")).toBe("on");
});

test("plStem: 1-letter case endings stripped (len ≥ 4)", () => {
  expect(plStem("domu")).toBe("dom");
  expect(plStem("domy")).toBe("dom");
  expect(plStem("wyboru")).toBe("wybor");
  expect(plStem("kawa")).toBe("kaw"); // accepted over-stripping for matching
  expect(plStem("kawy")).toBe("kaw"); // same stem → these match
});

test("plStem: 2-letter case endings (len ≥ 5)", () => {
  expect(plStem("domem")).toBe("dom");
  expect(plStem("domow")).toBe("dom");
});

test("plStem: 3-letter (-ego/-emu/-ach/-ami) (len ≥ 6)", () => {
  expect(plStem("malego")).toBe("mal");
  expect(plStem("dobrego")).toBe("dobr");
  expect(plStem("nowemu")).toBe("now");
  expect(plStem("domach")).toBe("dom");
  expect(plStem("domami")).toBe("dom");
});

test("plStem: inflections of 'informacja' all collapse to one stem", () => {
  const stem = "informacj";
  expect(plStem("informacja")).toBe(stem);
  expect(plStem("informacje")).toBe(stem);
  expect(plStem("informacji")).toBe(stem);
  expect(plStem("informacjom")).toBe(stem);
});

test("plStem composes with plNormalize", () => {
  // "wybór" → "wybor" (normalize) → "wybor" (stem, no suffix); 5 chars, no -r in suffixes
  // "wyboru" → "wyboru" (normalize) → "wybor" (stem -u)
  // Both end up at "wybor" → match via prefix
  expect(plStem(plNormalize("wybór"))).toBe("wybor");
  expect(plStem(plNormalize("wyboru"))).toBe("wybor");
});
