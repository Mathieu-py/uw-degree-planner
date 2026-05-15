/**
 * High-level transform for the browse page: takes the raw course list and
 * a FilterState, returns the sorted-and-filtered rows the UI consumes,
 * with eligibility computed when the user has supplied completed courses.
 *
 * Kept separate from `filters.ts` because eligibility evaluation is
 * expensive (prereq parsing + tree walk) and only the browse view needs it.
 */

import { applyFilters } from "./filters";
import { parsePrereqs } from "./prereqs/parse";
import { evaluate, type EligibilityResult } from "./prereqs/satisfied";
import type { Course, FilterState } from "./types";

export interface BrowseRow {
  course: Course;
  eligibility: EligibilityResult | null;
}

export function buildBrowseRows(
  courses: ReadonlyArray<Course>,
  state: FilterState,
): BrowseRow[] {
  const filtered = applyFilters(courses, state);
  const completed = new Set(state.completedCourses);
  const checkEligibility = state.completedCourses.length > 0;
  return filtered
    .map<BrowseRow>((course) => ({
      course,
      eligibility: checkEligibility
        ? evaluate(parsePrereqs(course.prereqs), { completed })
        : null,
    }))
    .filter((r) => !state.hideUnmetPrereqs || !r.eligibility || r.eligibility.satisfied);
}
