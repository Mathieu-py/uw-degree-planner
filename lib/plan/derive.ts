import type { EquivalenceIndex } from "@/lib/courses/equivalence";
import type { Course } from "@/lib/courses/types";
import { type TermId, termInfo } from "@/lib/terms";
import type { PlanSlot } from "./types";

/**
 * An academic term column — the only slots that hold picked courses and accept
 * drops. Excludes co-op and the pre-arrival (transfer-credit) slot.
 */
export function isAcademicSlot(slot: PlanSlot): boolean {
  return !slot.isCoop && slot.position !== "pre";
}

/**
 * Where the course — or a cross-listed twin — already sits, as a label ("Fall
 * 2025" / "your plan"), or null if unplaced. Twin-aware so the "already placed"
 * gate can't be dodged via the other code of a cross-listed pair (#21).
 */
export function placedCourseLabel(
  slots: PlanSlot[],
  course: Course,
): string | null {
  const codes = new Set([
    course.code.toLowerCase(),
    ...(course.crossListed ?? []),
  ]);
  const slot = slots.find((s) => s.courses.some((c) => codes.has(c.code)));
  if (!slot) return null;
  return slot.termId !== null
    ? (termInfo(slot.termId)?.label ?? "your plan")
    : "your plan";
}

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
 *
 * With `equiv`, the set is widened to include every cross-listed equivalent of a
 * completed course (GitHub #21), so a prereq naming one code is satisfied by an
 * equivalent the student actually took.
 */
export function completedSetFromPlan(
  plan: WithSlots,
  asOfTermId?: TermId,
  equiv?: EquivalenceIndex,
): Set<string> {
  const set = new Set(completedCoursesFromPlan(plan, asOfTermId));
  return equiv ? equiv.expand(set) : set;
}
