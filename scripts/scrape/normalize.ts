/** Normalize a raw course-code string ("CS 246" / "cs246") to catalog form ("cs246"). */
export function normalizeCourseCode(raw: string): string | null {
  const cleaned = raw.replace(/\s+/g, "").toUpperCase();
  const m = cleaned.match(/^([A-Z]{2,8})(\d{3,4}[A-Z]?)$/);
  return m ? (m[1] + m[2]).toLowerCase() : null;
}

// A course-code token in free text ("BUS127W", "INDEV 387"), allowing one space
// between subject and number.
export const TEXT_CODE_RE = /[A-Za-z]{2,8}\s?\d{3,4}[A-Za-z]?/g;

// A course-number RANGE ("CS340-CS398", "CS 440-489"): a set of courses, NOT a
// fixed list — must be expanded against the catalog, not scraped as two literal
// codes. Global + capturing, for finding/expanding every range token in a list.
// Groups: 1=start subject, 2=start number, 3=end subject (optional — "CS240-299"
// omits it), 4=end number.
export const CODE_RANGE_RE_G =
  /([A-Za-z]{2,8})\s?(\d{3,4})[A-Za-z]?\s*[-–—]\s*(?:([A-Za-z]{2,8})\s?)?(\d{3,4})[A-Za-z]?/g;

/**
 * Parse one course-number range token into its subject + numeric bounds. The
 * subject is the START prefix ("CS240-299" and "CS340-CS398" are both CS bands);
 * an end prefix, when present, is assumed to match and is ignored. Bounds are
 * normalized so `lo <= hi`. Null when the token isn't a range. Expansion to real
 * codes happens against the catalog (see catalog.ts) — endpoints are never
 * synthesized.
 */
export function parseCodeRange(
  token: string,
): { prefix: string; lo: number; hi: number } | null {
  const g = token.match(
    /([A-Za-z]{2,8})\s?(\d{3,4})[A-Za-z]?\s*[-–—]\s*(?:([A-Za-z]{2,8})\s?)?(\d{3,4})[A-Za-z]?/,
  );
  if (!g) return null;
  const a = Number(g[2]);
  const b = Number(g[4]);
  return {
    prefix: g[1].toLowerCase(),
    lo: Math.min(a, b),
    hi: Math.max(a, b),
  };
}

/**
 * Uppercase subject-code tokens (e.g. "BIOL", "ENVS") found in `text`, returned
 * lowercased (default) or uppercased. The match is case-sensitive, so only
 * already-uppercase tokens count — mixed-case prose words are ignored.
 */
export function extractSubjectCodes(
  text: string,
  to: "lower" | "upper" = "lower",
): string[] {
  const codes = text.match(/[A-Z]{2,8}/g) ?? [];
  return codes.map((s) => (to === "lower" ? s.toLowerCase() : s.toUpperCase()));
}
