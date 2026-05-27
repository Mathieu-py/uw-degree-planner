import type { TermId } from "@/lib/terms";
import type { LocalPlan } from "./types";

/**
 * Flatten the plan into a sorted list of unique course codes. If
 * `asOfTermId` is provided, only courses placed in slots whose `termId` is
 * STRICTLY less than `asOfTermId` are included (i.e. "completed before that
 * term started").
 *
 * Pre-arrival transfer credit (termId === null) is always included —
 * incoming credit doesn't have a calendar term but the student has it
 * regardless of cutoff.
 */
export function completedCoursesFromPlan(
  plan: LocalPlan,
  asOfTermId?: TermId,
): string[] {
  const out = new Set<string>();
  for (const slot of plan.slots) {
    const include =
      slot.termId === null ||
      asOfTermId === undefined ||
      slot.termId < asOfTermId;
    if (!include) continue;
    for (const c of slot.courses) out.add(c.code);
  }
  return [...out].sort();
}

/**
 * Set form of `completedCoursesFromPlan`, ready to feed directly into the
 * prereq evaluator (`evaluate()` in lib/prereqs/satisfied.ts).
 */
export function completedSetFromPlan(
  plan: LocalPlan,
  asOfTermId?: TermId,
): Set<string> {
  return new Set(completedCoursesFromPlan(plan, asOfTermId));
}
