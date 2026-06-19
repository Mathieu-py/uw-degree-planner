/** Normalize a raw course-code string ("CS 246" / "cs246") to catalog form ("cs246"). */
export function normalizeCourseCode(raw: string): string | null {
  const cleaned = raw.replace(/\s+/g, "").toUpperCase();
  const m = cleaned.match(/^([A-Z]{2,8})(\d{3,4}[A-Z]?)$/);
  return m ? (m[1] + m[2]).toLowerCase() : null;
}

// A course-code token in free text ("BUS127W", "INDEV 387"), allowing one space
// between subject and number.
export const TEXT_CODE_RE = /[A-Za-z]{2,8}\s?\d{3,4}[A-Za-z]?/g;

// A course-number range ("CS340-CS398", "CS 440-489"): courses to expand against
// the catalog, not two literal codes. Groups: 1=start subject, 2=start number,
// 3=end subject (optional — "CS240-299" omits it), 4=end number. One source for
// the global (find/replace) and non-global (parse) forms so they can't drift.
const CODE_RANGE_SRC =
  "([A-Za-z]{2,8})\\s?(\\d{3,4})[A-Za-z]?\\s*[-–—]\\s*(?:([A-Za-z]{2,8})\\s?)?(\\d{3,4})[A-Za-z]?";
export const CODE_RANGE_RE_G = new RegExp(CODE_RANGE_SRC, "g");
const CODE_RANGE_RE = new RegExp(CODE_RANGE_SRC);

/**
 * Parse one range token into subject + numeric bounds. The subject is the START
 * prefix (an end prefix, if present, is assumed to match and ignored); bounds are
 * normalized so `lo <= hi`. Null when not a range. Real codes are expanded against
 * the catalog (catalog.ts) — endpoints are never synthesized.
 */
export function parseCodeRange(
  token: string,
): { prefix: string; lo: number; hi: number } | null {
  const g = token.match(CODE_RANGE_RE);
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
