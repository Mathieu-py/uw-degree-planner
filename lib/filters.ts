import type { Course, FilterState, UWFlowCourse } from "./types";

const LEVEL_RE = /\d+/;
const PREFIX_RE = /^[A-Z]+/;

export function enrichCourse(raw: UWFlowCourse): Course {
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

export function passesRatingAndThreshold(
  course: Course,
  threshold: { easy: number; useful: number } | null,
): boolean {
  if (!threshold) return true;
  const easy = course.rating?.easy;
  const useful = course.rating?.useful;
  if (easy == null || useful == null) return true;
  return !(easy < threshold.easy && useful < threshold.useful);
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

export function passesIncludePrefixes(
  course: Course,
  includePrefixes: ReadonlyArray<string>,
): boolean {
  if (includePrefixes.length === 0) return true;
  return includePrefixes.includes(course.prefix);
}

/**
 * Each predicate self-gates on its slice of FilterState (false / empty array
 * / null threshold all mean "rule disabled, course passes"), so this is a
 * flat AND-chain with no outer toggle logic.
 */
export function applyFilters(
  courses: ReadonlyArray<Course>,
  s: FilterState,
): Course[] {
  return courses.filter(
    (c) =>
      passesPrefixExclusion(c, s.excludePrefixes) &&
      passesIncludePrefixes(c, s.includePrefixes) &&
      passesLevelFilter(c, s.levels) &&
      passesSeatsFilter(c, s.hasSeatsAvailable) &&
      passesRatingAndThreshold(c, s.ratingAndThreshold) &&
      passesMinUsefulFilter(c, s.minUseful) &&
      passesMinEasyFilter(c, s.minEasy),
  );
}
