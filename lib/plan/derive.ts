import type { TermId } from "@/lib/terms";
import type { PlanSlot } from "./types";

/**
 * Anything carrying plan slots. Both `LocalPlan` and `ServerPlan` satisfy this;
 * these derivations only read `slots`.
 */
type WithSlots = { slots: PlanSlot[] };

/**
 * Flatten the plan into a sorted list of unique course codes. With `asOfTermId`,
 * only slots whose `termId` is STRICTLY less are included ("completed before
 * that term"). Pre-arrival transfer credit (termId === null) is always
 * included regardless of cutoff.
 */
export function completedCoursesFromPlan(
  plan: WithSlots,
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
  plan: WithSlots,
  asOfTermId?: TermId,
): Set<string> {
  return new Set(completedCoursesFromPlan(plan, asOfTermId));
}
