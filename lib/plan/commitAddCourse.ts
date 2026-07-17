import { isProgramBlocked } from "@/lib/courses/courseEligibility";
import type { Course } from "@/lib/courses/types";
import { isAcademicSlot, placedCourseLabel } from "@/lib/plan/derive";
import { addCourseToSlot } from "@/lib/plan/mutateSlots";
import { loadServerPlan, savePlanState } from "@/lib/plan/server/actions";
import { toSnapshot } from "@/lib/plan/server/serialize";
import { loadPlan, savePlan } from "@/lib/plan/storage";
import type { PlanSlot } from "@/lib/plan/types";
import { programDetail } from "@/lib/programs/detail";
import { programIdentities } from "@/lib/programs/meta";
import { type TermId, termLabel } from "@/lib/terms";

/**
 * One-click "add course to a known term" — the detail page's `from=picker` path,
 * where plan + target term are already chosen so there's no term step.
 *
 * The no-preloaded-plan variant of the term pickers: it load→modify→saves rather
 * than editing a plan already in state. The pickers consume the same
 * {@link applyAddToPlan} core, so no add path drifts.
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
 * block, so an unrestricted course needs no detail fetch. A blocked read may be
 * a stale restriction the program's own rules override — load and re-check.
 * If detail can't load the verdict is unknown, not blocked: a network failure
 * must not present as an academic rule.
 */
async function blockGate(
  course: Course,
  plan: { programIds?: string[]; specializationIds?: Record<string, string> },
): Promise<"open" | "blocked" | "unknown"> {
  const programs = programIdentities(plan.programIds, plan.specializationIds);
  // Re-read refs per check: the awaited load fills the store between calls.
  const blocked = () =>
    isProgramBlocked(course, {
      programs,
      programReferenced: programDetail.planReferencedCodes(
        plan.programIds,
        plan.specializationIds,
      ),
    });
  if (!blocked()) return "open";
  await programDetail.load(plan.programIds ?? []);
  if (!programDetail.areLoaded(plan.programIds ?? [])) return "unknown";
  return blocked() ? "blocked" : "open";
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

/** Plan shape shared by LocalPlan and ServerPlan — all the core needs. */
type AddablePlan = {
  slots: PlanSlot[];
  programIds?: string[];
  specializationIds?: Record<string, string>;
};

export type ApplyAddResult<T> =
  | { status: "added"; plan: T }
  | { status: "already-placed"; label: string }
  | { status: "blocked" } // closed to the plan's program/faculty
  | { status: "unresolved" }; // no slot for the term, or block verdict unknown

/**
 * The shared gate/mutate core behind every add path: already-placed outranks
 * the block, then {@link blockGate}, then the mutation. Pure w.r.t. persistence
 * — callers own their load/save pair.
 */
export async function applyAddToPlan<T extends AddablePlan>(
  plan: T,
  target: TermId | PlanSlot,
  course: Course,
): Promise<ApplyAddResult<T>> {
  const placed = placedCourseLabel(plan.slots, course);
  if (placed) return { status: "already-placed", label: placed };
  const gate = await blockGate(course, plan);
  if (gate === "blocked") return { status: "blocked" };
  if (gate === "unknown") return { status: "unresolved" };
  const slot =
    typeof target === "number" ? slotForTerm(plan.slots, target) : target;
  if (!slot) return { status: "unresolved" };

  const updated = addCourseToSlot(plan, slot.id, {
    code: course.code.toLowerCase(),
  });
  if (updated === plan) {
    return {
      status: "already-placed",
      label: slot.termId !== null ? termLabel(slot.termId) : "your plan",
    };
  }
  return { status: "added", plan: updated };
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
  if (isAuthed) {
    // Signed-in plans always carry their id in the picker link; without one we
    // can't resolve a server plan — fall back to the full picker.
    if (!planId) return { status: "unresolved" };
    const res = await loadServerPlan(planId);
    if (!res.ok) return { status: "error", error: res.error };
    if (!res.data) return { status: "error", error: "not_found" };

    const applied = await applyAddToPlan(res.data, term, course);
    if (applied.status !== "added") return applied;
    // Full atomic REPLACE — send the whole plan so other courses aren't clobbered.
    const save = await savePlanState(planId, toSnapshot(applied.plan));
    if (!save.ok) return { status: "error", error: save.error };
    return { status: "added", termLabel: termLabel(term) };
  }

  // Signed-out: the single local plan in localStorage.
  const plan = loadPlan();
  if (!plan) return { status: "unresolved" };

  const applied = await applyAddToPlan(plan, term, course);
  if (applied.status !== "added") return applied;
  // savePlan re-stamps updatedAt itself.
  if (!savePlan(applied.plan)) return { status: "error", error: "save_failed" };
  return { status: "added", termLabel: termLabel(term) };
}
