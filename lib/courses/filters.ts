import { courseLevel, levelBucket } from "./code";
import type { CatalogCourse, Course, PureFilters } from "./types";

const PREFIX_RE = /^[A-Z]+/;

/**
 * A `PureFilters` with all rules disabled — every course passes. A starting
 * point for tests and the picker's "no filters applied" sentinel.
 */
export const DEFAULT_PURE_FILTERS: PureFilters = {
  excludePrefixes: [],
  includePrefixes: [],
  levels: [],
  hasSeatsAvailable: false,
  hideUnmetPrereqs: false,
  minUseful: null,
  minEasy: null,
};

/**
 * Sum of remaining capacity across sections, or null when the course has no
 * scheduled sections (distinct from "0 seats open").
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
  const level = courseLevel(raw.code);
  const hasSeats = raw.sections.some(
    (s) => s.enrollment_capacity > s.enrollment_total,
  );
  // `units` rides along on `raw` (a CatalogCourse field) — no join needed.
  return { ...raw, prefix, level, hasSeats };
}

export function passesPrefixExclusion(
  course: Course,
  excludePrefixes: ReadonlyArray<string>,
): boolean {
  return !excludePrefixes.includes(course.prefix);
}

/**
 * Allow-list gate: passes everything when the list is empty, else only matching
 * prefixes. AND-chained with {@link passesPrefixExclusion}, so a prefix in both
 * lists is hidden — exclude wins, no special-casing.
 */
export function passesPrefixInclusion(
  course: Course,
  includePrefixes: ReadonlyArray<string>,
): boolean {
  if (includePrefixes.length === 0) return true;
  return includePrefixes.includes(course.prefix);
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
  return levels.includes(levelBucket(course.level));
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
 * Each predicate self-gates on its slice of PureFilters (false / empty / null
 * = "disabled, passes"), so this is a flat AND-chain with no outer toggles.
 */
export function applyFilters(
  courses: ReadonlyArray<Course>,
  s: PureFilters,
): Course[] {
  return courses.filter(
    (c) =>
      passesPrefixExclusion(c, s.excludePrefixes) &&
      passesPrefixInclusion(c, s.includePrefixes) &&
      passesLevelFilter(c, s.levels) &&
      passesSeatsFilter(c, s.hasSeatsAvailable) &&
      passesMinUsefulFilter(c, s.minUseful) &&
      passesMinEasyFilter(c, s.minEasy),
  );
}
