/** Normalize a raw course-code string ("CS 246" / "cs246") to catalog form ("cs246"). */
export function normalizeCourseCode(raw: string): string | null {
  const cleaned = raw.replace(/\s+/g, "").toUpperCase();
  const m = cleaned.match(/^([A-Z]{2,8})(\d{3,4}[A-Z]?)$/);
  return m ? (m[1] + m[2]).toLowerCase() : null;
}

// A course-code token in free text ("BUS127W", "INDEV 387"), allowing one space
// between subject and number.
export const TEXT_CODE_RE = /[A-Za-z]{2,8}\s?\d{3,4}[A-Za-z]?/g;

// A course-number RANGE ("CS340-CS398", "CS 440-489", "600- or 700-level"): a
// set of courses, NOT a fixed list — must not be scraped as two literal codes.
export const CODE_RANGE_RE =
  /[A-Za-z]{2,8}\s?\d{3,4}[A-Za-z]?\s*[-–—]\s*(?:[A-Za-z]{2,8}\s?)?\d{3,4}/;
