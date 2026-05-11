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
