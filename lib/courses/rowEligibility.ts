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

/**
 * The picker's "Show" filter — one control merging the old hide-unmet toggle
 * and an eligibility filter (they're the same axis):
 * - `eligible`      — only courses that come back eligible.
 * - `eligibleCheck` — eligible + uncertain ("check"); drops the definitely-
 *   ineligible (missing prereq / wrong program / antireq). The default.
 * - `all`           — everything, each row keeping its status chip.
 */
export type ShowFilter = "eligible" | "eligibleCheck" | "all";

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
  /** Which eligibility states to keep (see {@link ShowFilter}). */
  show: ShowFilter;
  /** Target term's level ("2A") for level-gated prereqs. */
  level?: string;
  /** Student's program(s) for program-restriction prereqs (double degree → more than one). */
  programs?: ProgramIdentity[];
  /** Codes co-scheduled in the target term (lets coreqs resolve same-term). */
  sameTerm?: ReadonlySet<string>;
  /** Reverse antireqs: code → placed courses naming it (symmetric flagging). */
  placedAntireqNamers?: ReadonlyMap<string, readonly string[]>;
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
    show,
    level,
    programs,
    sameTerm,
    placedAntireqNamers,
  } = opts;
  const canAssessPrereqs = completed.size > 0;
  return rows
    .map<EligibilityRow>((r) => {
      const verdict = evaluateCourseEligibility(r.course, {
        completed,
        sameTerm,
        level,
        programs,
        programReferenced,
        placedAnywhere,
        placedAntireqNamers,
      });
      // Without a completed set, only term-independent verdicts are trustworthy;
      // suppress prereq-based chips/filtering. Already-placed (incl. a placed
      // cross-listed twin), antireq, and program/faculty blocks don't depend on
      // completed courses, so they always stand.
      const trustworthy =
        canAssessPrereqs ||
        verdict.alreadyPlaced ||
        verdict.antireqConflicts.length > 0 ||
        verdict.blockedByProgram;
      return { course: r.course, eligibility: trustworthy ? verdict : null };
    })
    .filter((r) => {
      if (show === "all") return true;
      const v = r.eligibility;
      // Uncertain (null) rows can't be judged: keep under the default
      // "eligibleCheck", drop under strict "eligible".
      if (!v) return show === "eligibleCheck";
      if (show === "eligible") return v.state === "eligible";
      return v.state !== "ineligible"; // eligibleCheck
    });
}
