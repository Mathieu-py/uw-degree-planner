import {
  ART_PREFIXES,
  ESSAY_HEAVY_PREFIXES,
  HEALTH_ENV_PREFIXES,
  LANGUAGE_PREFIXES,
  MISC_EXCLUDED_PREFIXES,
  SOCIAL_PREFIXES,
  SYDE_OVERLAP_PREFIXES,
} from "./prefixes";
import type { Course, FilterState, UWFlowCourse } from "~/types";

const LEVEL_RE = /\d+/;
const PREFIX_RE = /^[A-Z]+/;
const PREREQ_TOKEN_RE = /[a-z]{2,}[0-9]{2,}/gi;

export function enrichCourse(raw: UWFlowCourse): Course {
  const code = raw.code;
  const upper = code.toUpperCase();
  const prefix = upper.match(PREFIX_RE)?.[0] ?? upper.split(/\d/)[0];
  const levelMatch = code.match(LEVEL_RE);
  const level = levelMatch ? parseInt(levelMatch[0], 10) : 0;
  const hasSeats = raw.sections.some(
    (s) => s.enrollment_capacity > s.enrollment_total,
  );
  return { ...raw, prefix, level, hasSeats };
}

/** Predicates — each returns true iff the course passes the rule. */

export function passesPrefixExclusion(
  course: Course,
  excludePrefixes: ReadonlyArray<string>,
): boolean {
  return !excludePrefixes.includes(course.prefix);
}

export function passesEssayHeavyFilter(
  course: Course,
  allowPsych101Exception: boolean,
): boolean {
  if (!ESSAY_HEAVY_PREFIXES.includes(course.prefix as never)) return true;
  if (allowPsych101Exception && course.code.toLowerCase() === "psych101") {
    return true;
  }
  return false;
}

export function passesAncientMedievalFilter(course: Course): boolean {
  const name = course.name.toLowerCase();
  return !name.includes("ancient") && !name.includes("medieval");
}

export function passesWLUFilter(course: Course): boolean {
  const codeLower = course.code.toLowerCase();
  const nameLower = course.name.toLowerCase();
  return !codeLower.endsWith("w") && !nameLower.includes("wlu");
}

export function passesEnvKeywordFilter(course: Course): boolean {
  const name = course.name.toLowerCase();
  return (
    !name.includes("environment") &&
    !name.includes("climate") &&
    !name.includes("sustainability")
  );
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

/**
 * First-pass prereq check: substring match against the lowercased prereq
 * string. Imprecise (treats "or" as "and"); replaced by lib/prereqs/satisfied.ts
 * once the AST parser lands.
 */
export function passesPrereqSubstringFilter(
  course: Course,
  completedCourses: ReadonlyArray<string>,
): boolean {
  if (!course.prereqs || course.prereqs.trim() === "") return true;
  const prereqLower = course.prereqs.toLowerCase();
  const noneCompletedMentioned = !completedCourses.some((c) =>
    prereqLower.includes(c),
  );
  const tokens = prereqLower.match(PREREQ_TOKEN_RE);
  const someTokenUnmet = tokens?.some(
    (t) => !completedCourses.includes(t.toLowerCase()),
  );
  const hasUnmetPrereqs = noneCompletedMentioned || someTokenUnmet;
  return !hasUnmetPrereqs;
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

/** Compose all filters according to a FilterState. */
export function applyFilters(
  courses: ReadonlyArray<Course>,
  state: FilterState,
): Course[] {
  return courses.filter((c) => {
    if (!passesPrefixExclusion(c, state.excludePrefixes)) return false;
    if (!passesIncludePrefixes(c, state.includePrefixes)) return false;
    if (state.excludeEssayHeavy && !passesEssayHeavyFilter(c, state.allowPsych101Exception)) {
      return false;
    }
    if (state.excludeAncientMedieval && !passesAncientMedievalFilter(c)) return false;
    if (state.excludeWLU && !passesWLUFilter(c)) return false;
    if (state.excludeEnvKeywords && !passesEnvKeywordFilter(c)) return false;
    if (!passesRatingAndThreshold(c, state.ratingAndThreshold)) return false;
    if (!passesMinUsefulFilter(c, state.minUseful)) return false;
    if (!passesMinEasyFilter(c, state.minEasy)) return false;
    if (state.hideUnmetPrereqs && !passesPrereqSubstringFilter(c, state.completedCourses)) {
      return false;
    }
    if (!passesLevelFilter(c, state.levels)) return false;
    if (!passesSeatsFilter(c, state.hasSeatsAvailable)) return false;
    return true;
  });
}

/**
 * SYDE defaults — the regression baseline (27 codes in
 * scripts/check-regression.ts) pins this exact filter result against the
 * committed snapshot. Don't change without re-running pnpm regression.
 */
export const SYDE_M1_DEFAULTS: FilterState = {
  term: 1261,
  excludePrefixes: [
    ...LANGUAGE_PREFIXES,
    ...ART_PREFIXES,
    ...SOCIAL_PREFIXES,
    ...MISC_EXCLUDED_PREFIXES,
    ...SYDE_OVERLAP_PREFIXES,
    ...HEALTH_ENV_PREFIXES,
    "ENGL",
  ],
  includePrefixes: [],
  levels: [100, 200, 300],
  hasSeatsAvailable: true,
  completedCourses: ["math116", "math117"],
  hideUnmetPrereqs: true,
  ratingAndThreshold: { easy: 0.4, useful: 0.5 },
  minUseful: null,
  minEasy: null,
  excludeWLU: true,
  excludeAncientMedieval: true,
  excludeEnvKeywords: true,
  excludeEssayHeavy: true,
  allowPsych101Exception: true,
};
