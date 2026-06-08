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

/**
 * Subject + level membership test for a "pool" of courses, shared by the audit's
 * subjectPool rules, unit-based electives, and level floors. All list fields must
 * be lowercase (callers normalize once per pool, not per code).
 */
export interface PoolFilter {
  /** Subject prefixes that qualify. Present-but-no-match excludes; omit for any. */
  subjects?: readonly string[];
  /** Inclusive level bounds, bucketed to the hundred. */
  minLevel?: number;
  maxLevel?: number;
  /** Subject prefixes to exclude. */
  excludeSubjects?: readonly string[];
}

/** Whether a placed `code` satisfies a {@link PoolFilter}'s subject + level bounds. */
export function poolMatch(code: string, f: PoolFilter): boolean {
  const prefix = coursePrefix(code);
  if (f.subjects && !f.subjects.includes(prefix)) return false;
  if (f.excludeSubjects?.includes(prefix)) return false;
  const lvl = levelBucket(courseLevel(code));
  if (f.minLevel != null && lvl < f.minLevel) return false;
  if (f.maxLevel != null && lvl > f.maxLevel) return false;
  return true;
}
