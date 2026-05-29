import type { CatalogCourse, Course, PureFilters } from "./types";

const LEVEL_RE = /\d+/;
const PREFIX_RE = /^[A-Z]+/;

/**
 * A `PureFilters` with all rules disabled — every course passes. Useful as
 * a starting point in tests and as the picker's "no user filters applied"
 * sentinel.
 */
export const DEFAULT_PURE_FILTERS: PureFilters = {
  excludePrefixes: [],
  levels: [],
  hasSeatsAvailable: false,
  hideUnmetPrereqs: false,
  minUseful: null,
  minEasy: null,
};

/**
 * Sum of remaining capacity across all sections, or null when the course has
 * no scheduled sections (distinct from "0 seats open"). Lives here because it
 * derives from the same enrollment data as `enrichCourse`'s `hasSeats`.
 */
export function seatsAvailable(course: Course): number | null {
  if (course.sections.length === 0) return null;
  return course.sections.reduce(
    (sum, s) => sum + Math.max(0, s.enrollment_capacity - s.enrollment_total),
    0,
  );
}

export function enrichCourse(raw: CatalogCourse): Course {
  const upper = raw.code.toUpperCase();
  const prefix = upper.match(PREFIX_RE)?.[0] ?? "";
  const levelMatch = upper.match(LEVEL_RE);
  const level = levelMatch ? parseInt(levelMatch[0], 10) : 0;
  const hasSeats = raw.sections.some(
    (s) => s.enrollment_capacity > s.enrollment_total,
  );
  return { ...raw, prefix, level, hasSeats };
}

export function passesPrefixExclusion(
  course: Course,
  excludePrefixes: ReadonlyArray<string>,
): boolean {
  return !excludePrefixes.includes(course.prefix);
}

export function passesMinUsefulFilter(
  course: Course,
  minUseful: number | null,
): boolean {
  if (minUseful == null) return true;
  return (course.rating?.useful ?? 0) >= minUseful;
}

export function passesMinEasyFilter(
  course: Course,
  minEasy: number | null,
): boolean {
  if (minEasy == null) return true;
  return (course.rating?.easy ?? 0) >= minEasy;
}

export function passesLevelFilter(
  course: Course,
  levels: ReadonlyArray<number>,
): boolean {
  if (levels.length === 0) return true;
  const bucket = Math.floor(course.level / 100) * 100;
  return levels.includes(bucket);
}

export function passesSeatsFilter(
  course: Course,
  requireSeats: boolean,
): boolean {
  if (!requireSeats) return true;
  if (course.sections.length === 0) return false;
  return course.hasSeats;
}

/**
 * Each predicate self-gates on its slice of PureFilters (false / empty array
 * / null threshold all mean "rule disabled, course passes"), so this is a
 * flat AND-chain with no outer toggle logic.
 */
export function applyFilters(
  courses: ReadonlyArray<Course>,
  s: PureFilters,
): Course[] {
  return courses.filter(
    (c) =>
      passesPrefixExclusion(c, s.excludePrefixes) &&
      passesLevelFilter(c, s.levels) &&
      passesSeatsFilter(c, s.hasSeatsAvailable) &&
      passesMinUsefulFilter(c, s.minUseful) &&
      passesMinEasyFilter(c, s.minEasy),
  );
}
