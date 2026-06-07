/**
 * Pure helpers for reading a course code's structure ("CS486", "MATH135"),
 * shared by the catalog filters and audit compiler. Extract, never validate —
 * an unparseable code yields level 0 / empty prefix rather than throwing.
 */

const LEVEL_RE = /\d+/;
const PREFIX_RE = /^[a-z]+/i;

/** Numeric course level, e.g. "CS486" → 486. 0 when the code has no digits. */
export function courseLevel(code: string): number {
  const m = code.match(LEVEL_RE);
  return m ? parseInt(m[0], 10) : 0;
}

/** A numeric level bucketed to the hundred, e.g. 486 → 400. */
export function levelBucket(level: number): number {
  return Math.floor(level / 100) * 100;
}

/** Lowercased subject prefix, e.g. "CS486" → "cs". Empty when none. */
export function coursePrefix(code: string): string {
  return (code.match(PREFIX_RE)?.[0] ?? "").toLowerCase();
}
