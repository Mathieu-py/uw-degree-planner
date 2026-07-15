import { isCourseBlockedForPlan } from "@/lib/courses/courseEligibility";
import type { Course } from "@/lib/courses/types";
import { isAcademicSlot, placedCourseLabel } from "@/lib/plan/derive";
import { addCourseToSlot } from "@/lib/plan/mutateSlots";
import { loadServerPlan, savePlanState } from "@/lib/plan/server/actions";
import { toSnapshot } from "@/lib/plan/server/serialize";
import { loadPlan, savePlan } from "@/lib/plan/storage";
import type { PlanSlot } from "@/lib/plan/types";
import { programDetail } from "@/lib/programs/detail";
import { type TermId, termLabel } from "@/lib/terms";

/**
 * One-click "add course to a known term" — the detail page's `from=picker` path,
 * where plan + target term are already chosen so there's no term step.
 *
 * The no-preloaded-plan variant of the term pickers: it load→modify→saves rather
 * than editing a plan already in state. Same gates ({@link isCourseBlockedForPlan}
 * + {@link placedCourseLabel}) and sinks (`savePlanState` / `savePlan` over
 * {@link addCourseToSlot}) as the pickers, so no add path drifts.
 */
export type CommitAddResult =
  | { status: "added"; termLabel: string }
  | { status: "already-placed"; label: string }
  | { status: "blocked" } // closed to the plan's program/faculty
  // Term no longer maps to a slot, no plan loaded, or the block check couldn't
  // be resolved (program detail unavailable) — the caller falls back to the
  // full picker rather than asserting a verdict.
  | { status: "unresolved" }
  | { status: "error"; error: string };

/**
 * The program/faculty gate, cache-first: referenced codes only ever SUPPRESS a
 * block, so an unrestricted course needs no detail fetch. A blocked read may
 * still be a stale restriction the program's own rules override — load detail
 * and re-check. If detail can't load, the verdict is unknown, not blocked:
 * a network failure must not present as an academic rule.
 */
async function blockGate(
  course: Course,
  plan: { programIds?: string[]; specializationIds?: Record<string, string> },
): Promise<"open" | "blocked" | "unknown"> {
  if (!isCourseBlockedForPlan(course, plan)) return "open";
  await programDetail.load(plan.programIds ?? []);
  if (!programDetail.areLoaded(plan.programIds ?? [])) return "unknown";
  return isCourseBlockedForPlan(course, plan) ? "blocked" : "open";
}

/**
 * The academic slot for `term`, preferring a non-coop/non-pre slot (belt-and-
 * suspenders — a calendar term maps to at most one such slot in the cadence).
 */
function slotForTerm(slots: PlanSlot[], term: TermId): PlanSlot | undefined {
  return (
    slots.find((s) => s.termId === term && isAcademicSlot(s)) ??
    slots.find((s) => s.termId === term)
  );
}

export async function commitAddCourse({
  isAuthed,
  planId,
  term,
  course,
}: {
  isAuthed: boolean;
  planId: string | null;
  term: TermId;
  course: Course;
}): Promise<CommitAddResult> {
  const code = course.code.toLowerCase();

  if (isAuthed) {
    // Signed-in plans always carry their id in the picker link; without one we
    // can't resolve a server plan — fall back to the full picker.
    if (!planId) return { status: "unresolved" };
    const res = await loadServerPlan(planId);
    if (!res.ok) return { status: "error", error: res.error };
    if (!res.data) return { status: "error", error: "not_found" };
    const plan = res.data;

    // Already-placed outranks the block (matches the term pickers). The block
    // gate is the one the slot picker enforces — no program-blocked course
    // slips through the one-click path.
    const placed = placedCourseLabel(plan.slots, course);
    if (placed) return { status: "already-placed", label: placed };
    const gate = await blockGate(course, plan);
    if (gate === "blocked") return { status: "blocked" };
    if (gate === "unknown") return { status: "unresolved" };
    const slot = slotForTerm(plan.slots, term);
    if (!slot) return { status: "unresolved" };

    const updated = addCourseToSlot(plan, slot.id, { code });
    if (updated === plan) {
      return { status: "already-placed", label: termLabel(term) };
    }
    // Full atomic REPLACE — send the whole plan so other courses aren't clobbered.
    const save = await savePlanState(planId, toSnapshot(updated));
    if (!save.ok) return { status: "error", error: save.error };
    return { status: "added", termLabel: termLabel(term) };
  }

  // Signed-out: the single local plan in localStorage.
  const plan = loadPlan();
  if (!plan) return { status: "unresolved" };

  const placed = placedCourseLabel(plan.slots, course);
  if (placed) return { status: "already-placed", label: placed };
  const gate = await blockGate(course, plan);
  if (gate === "blocked") return { status: "blocked" };
  if (gate === "unknown") return { status: "unresolved" };
  const slot = slotForTerm(plan.slots, term);
  if (!slot) return { status: "unresolved" };

  const updated = addCourseToSlot(plan, slot.id, { code });
  if (updated === plan) {
    return { status: "already-placed", label: termLabel(term) };
  }
  // savePlan re-stamps updatedAt itself.
  if (!savePlan(updated)) return { status: "error", error: "save_failed" };
  return { status: "added", termLabel: termLabel(term) };
}
