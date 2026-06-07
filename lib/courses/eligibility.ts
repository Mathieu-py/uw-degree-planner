/**
 * Eligibility annotation for slot-picker rows. Separate from `filters.ts` since
 * evaluation is expensive and only the picker needs it. Delegates to the shared
 * {@link evaluateCourseEligibility}.
 */

import type { ProgramIdentity } from "@/lib/programs";
import {
  type CourseEligibilityVerdict,
  evaluateCourseEligibility,
} from "./courseEligibility";
import type { Course } from "./types";

const EMPTY_SET: ReadonlySet<string> = new Set();

export interface EligibilityRow {
  course: Course;
  eligibility: CourseEligibilityVerdict | null;
}

export interface AttachEligibilityOptions {
  /** Codes completed strictly before the target term. */
  completed: ReadonlySet<string>;
  /** Every code placed anywhere in the plan (antireqs + duplicate). */
  placedAnywhere: ReadonlySet<string>;
  /**
   * Codes the student's program references (suppresses stale program blocks).
   * Omitted by the program-less catalog browse, where nothing is suppressed.
   */
  programReferenced?: ReadonlySet<string>;
  /** Drop rows that come back ineligible. */
  hideUnmetPrereqs: boolean;
  /** Target term's level ("2A") for level-gated prereqs. */
  level?: string;
  /** Student's program for program-restriction prereqs. */
  program?: ProgramIdentity;
  /** Codes co-scheduled in the target term (lets coreqs resolve same-term). */
  sameTerm?: ReadonlySet<string>;
}

/**
 * Annotate rows with an eligibility verdict, optionally dropping ineligible
 * ones. With an empty `completed` set we can't judge prereqs, so those verdicts
 * carry no chip and aren't hidden; the term-independent antireq check still
 * applies.
 */
export function attachEligibility(
  rows: EligibilityRow[],
  opts: AttachEligibilityOptions,
): EligibilityRow[] {
  const {
    completed,
    placedAnywhere,
    programReferenced = EMPTY_SET,
    hideUnmetPrereqs,
    level,
    program,
    sameTerm,
  } = opts;
  const canAssessPrereqs = completed.size > 0;
  return rows
    .map<EligibilityRow>((r) => {
      const verdict = evaluateCourseEligibility(r.course, {
        completed,
        sameTerm,
        level,
        program,
        programReferenced,
        placedAnywhere,
      });
      // Without a completed set, only the antireq verdict is trustworthy;
      // suppress prereq-based chips/filtering. (The duplicate verdict never
      // fires here — candidates are pre-filtered in useFilteredCourses.)
      const trustworthy =
        canAssessPrereqs || verdict.antireqConflicts.length > 0;
      return { course: r.course, eligibility: trustworthy ? verdict : null };
    })
    .filter(
      (r) =>
        !hideUnmetPrereqs ||
        !r.eligibility ||
        r.eligibility.state !== "ineligible",
    );
}
