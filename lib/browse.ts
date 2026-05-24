/**
 * Eligibility annotation for the slot-picker rows. Kept separate from
 * `filters.ts` because eligibility evaluation is expensive (prereq parsing +
 * tree walk) and only the picker view needs it.
 */

import { type PrereqNode, parsePrereqs } from "./prereqs/parse";
import { type EligibilityResult, evaluate } from "./prereqs/satisfied";
import type { Course } from "./types";

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

/**
 * Annotate rows with eligibility against `completed` and optionally drop rows
 * with unmet prereqs. Empty `completed` short-circuits — eligibility stays
 * null and hideUnmetPrereqs becomes a no-op (an unknown eligibility is not
 * "unmet").
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
