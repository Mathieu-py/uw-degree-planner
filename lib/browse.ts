/**
 * High-level transform for the browse page: takes the raw course list, the
 * PureFilters slice, and the completed-courses list, returns the
 * sorted-and-filtered rows the UI consumes, with eligibility computed when
 * the user has supplied completed courses.
 *
 * Kept separate from `filters.ts` because eligibility evaluation is
 * expensive (prereq parsing + tree walk) and only the browse view needs it.
 */

import { applyFilters } from "./filters";
import { type PrereqNode, parsePrereqs } from "./prereqs/parse";
import { type EligibilityResult, evaluate } from "./prereqs/satisfied";
import type { Course, PureFilters } from "./types";

const prereqCache = new Map<string, PrereqNode | null>();

function cachedParsePrereqs(
  text: string | null | undefined,
): PrereqNode | null {
  const key = text ?? "";
  if (prereqCache.has(key)) return prereqCache.get(key) ?? null;
  const parsed = parsePrereqs(text);
  prereqCache.set(key, parsed);
  return parsed;
}

export interface BrowseRow {
  course: Course;
  eligibility: EligibilityResult | null;
}

export function buildBrowseRows(
  courses: ReadonlyArray<Course>,
  filters: PureFilters,
  completedCourses: string[],
): BrowseRow[] {
  const filtered = applyFilters(courses, filters);
  const baseRows: BrowseRow[] = filtered.map((course) => ({
    course,
    eligibility: null,
  }));
  return attachEligibility(
    baseRows,
    completedCourses,
    filters.hideUnmetPrereqs,
  );
}

/**
 * Annotate rows with eligibility against `completed` and optionally drop rows
 * with unmet prereqs. Empty `completed` short-circuits — eligibility stays
 * null and hideUnmetPrereqs becomes a no-op (an unknown eligibility is not
 * "unmet"). Called server-side via buildBrowseRows with an empty list, and
 * re-run client-side by CourseBrowser once localStorage hydrates.
 */
export function attachEligibility(
  rows: BrowseRow[],
  completed: string[],
  hideUnmetPrereqs: boolean,
): BrowseRow[] {
  if (completed.length === 0) return rows;
  const completedSet = new Set(completed);
  return rows
    .map<BrowseRow>((r) => ({
      course: r.course,
      eligibility: evaluate(cachedParsePrereqs(r.course.prereqs), {
        completed: completedSet,
      }),
    }))
    .filter(
      (r) => !hideUnmetPrereqs || !r.eligibility || r.eligibility.satisfied,
    );
}
