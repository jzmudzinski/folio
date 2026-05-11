const PL_MAP: Record<string, string> = {
  ą: "a", Ą: "a",
  ć: "c", Ć: "c",
  ę: "e", Ę: "e",
  ł: "l", Ł: "l",
  ń: "n", Ń: "n",
  ó: "o", Ó: "o",
  ś: "s", Ś: "s",
  ź: "z", Ź: "z",
  ż: "z", Ż: "z",
};

/**
 * Strip Polish diacritics that FTS5 `remove_diacritics 2` doesn't handle.
 *
 * FTS5 only strips combining marks; ł/Ł are independent codepoints (U+0142/U+0141)
 * and pass through unchanged. We normalize ALL Polish letters here for symmetry —
 * apply both at FTS insert AND query time so "swieze" finds "świeże" and
 * "malego" finds "małego".
 */
export function plNormalize(s: string): string {
  return s.replace(/[ąĄćĆęĘłŁńŃóÓśŚźŹżŻ]/g, (c) => PL_MAP[c] ?? c);
}

/**
 * Light-weight Polish suffix stemmer for FTS query expansion.
 *
 * Polish has rich inflection — same lemma takes ~14 case+number forms.
 * SQLite FTS5 has no PL stemmer; native `unicode61` is a tokenizer only.
 * We apply this stemmer ONLY at query time (not index) so:
 *   1. Index keeps full plNormalized tokens → snippet shows real words
 *   2. Query gets shortened → prefix-match catches more inflections
 *
 * Examples:
 *   query "wyboru"   → stem "wybor"   → matches indexed "wybor" (from "wybór" plNormalized)
 *   query "kostek"   → stem "kostek"  → no suffix match, stays
 *   query "domu"     → stem "dom"     → matches "dom", "domu", "domy", "domem", "domów"
 *   query "informacja" → stem "informacj" → matches "informacja", "informacje", "informacji"
 *
 * Conservative on length — single-letter strip only on words ≥5 chars after norm.
 * Won't touch base forms ("dom", "być", "ja" stay intact).
 */
const PL_SUFFIXES_3 = ["ego", "emu", "ach", "ami", "owi", "iej", "ich"];
const PL_SUFFIXES_2 = ["em", "om", "ow", "ej"];
const PL_SUFFIXES_1 = ["a", "e", "i", "o", "u", "y"];

export function plStem(word: string): string {
  // Each tier requires enough leftover characters for the stem (≥3).
  for (const suf of PL_SUFFIXES_3) {
    if (word.length >= 6 && word.endsWith(suf)) return word.slice(0, -3);
  }
  for (const suf of PL_SUFFIXES_2) {
    if (word.length >= 5 && word.endsWith(suf)) return word.slice(0, -2);
  }
  for (const suf of PL_SUFFIXES_1) {
    if (word.length >= 4 && word.endsWith(suf)) return word.slice(0, -1);
  }
  return word;
}

export function slugify(input: string, maxLen = 80): string {
  let s = input.normalize("NFC");
  s = s.replace(/[ąĄćĆęĘłŁńŃóÓśŚźŹżŻ]/g, (c) => PL_MAP[c] ?? c);
  s = s.toLowerCase();
  s = s.replace(/[^a-z0-9\-_\s]/g, " ");
  s = s.replace(/\s+/g, "-");
  s = s.replace(/-+/g, "-");
  s = s.replace(/^-|-$/g, "");
  if (s.length > maxLen) s = s.slice(0, maxLen).replace(/-[^-]*$/, "");
  return s || "untitled";
}
