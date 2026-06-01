/**
 * Small pure helpers for reading the structure of a course code (e.g. "CS486",
 * "MATH135"). Shared by the catalog filters and the audit compiler so the
 * level/prefix extraction lives in one place. These extract, never validate —
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
