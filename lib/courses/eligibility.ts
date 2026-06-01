/**
 * Eligibility annotation for the slot-picker rows. Kept separate from
 * `filters.ts` because eligibility evaluation is expensive (prereq parsing +
 * tree walk) and only the picker view needs it.
 */

import { cachedParsePrereqs } from "@/lib/prereqs/cache";
import { type EligibilityResult, evaluate } from "@/lib/prereqs/satisfied";
import type { ProgramIdentity } from "@/lib/programs";
import type { Course } from "./types";

export interface EligibilityRow {
  course: Course;
  eligibility: EligibilityResult | null;
}

/**
 * Annotate rows with eligibility against `completed` and optionally drop rows
 * with unmet prereqs. Empty `completed` short-circuits — eligibility stays
 * null and hideUnmetPrereqs becomes a no-op (an unknown eligibility is not
 * "unmet").
 *
 * `level` (e.g. "2A") resolves level-gated prereqs to eligible/missing instead
 * of "check"; omit it for slots with no academic level (pre-arrival / co-op).
 * `program` resolves program-restriction prereqs the same way.
 */
export function attachEligibility(
  rows: EligibilityRow[],
  completed: ReadonlySet<string>,
  hideUnmetPrereqs: boolean,
  level?: string,
  program?: ProgramIdentity,
): EligibilityRow[] {
  if (completed.size === 0) return rows;
  return rows
    .map<EligibilityRow>((r) => ({
      course: r.course,
      eligibility: evaluate(cachedParsePrereqs(r.course.prereqs), {
        completed,
        level,
        program,
      }),
    }))
    .filter(
      (r) => !hideUnmetPrereqs || !r.eligibility || r.eligibility.satisfied,
    );
}
