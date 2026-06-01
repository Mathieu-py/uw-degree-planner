import { formatCourseCode } from "@/lib/format";
import { completedSetFromPlan } from "@/lib/plan/derive";
import type { PlanSlot } from "@/lib/plan/types";
import type { PrereqNode } from "@/lib/prereqs/parse";
import { evaluate } from "@/lib/prereqs/satisfied";
import { termInfo } from "@/lib/terms";

export type TermState = "eligible" | "check" | "missing";

export interface TermOption {
  slot: PlanSlot;
  label: string;
  state: TermState;
  hint: string;
}

/**
 * Per-term eligibility for adding `course` to a plan from the catalog. The
 * catalog has no target term, so we run the prereq check against every
 * academic term: a course is "missing prereqs" in early terms and becomes
 * "eligible" once its prereqs sit in earlier terms.
 *
 * Pure and plan-shape-agnostic (reads only `slots`) so the signed-out local
 * plan and a signed-in `ServerPlan` share one source of eligibility truth.
 * Pre-arrival and co-op slots are not addable targets and are excluded.
 */
export function computeTermOptions(
  slots: PlanSlot[],
  prereqNode: PrereqNode | null,
): TermOption[] {
  return slots
    .filter((s) => s.position !== "pre" && !s.isCoop)
    .map((slot) => {
      const completed = completedSetFromPlan(
        { slots },
        slot.termId ?? undefined,
      );
      const result = evaluate(prereqNode, { completed });
      const state: TermState = !result.satisfied
        ? "missing"
        : result.uncertain
          ? "check"
          : "eligible";
      const hint =
        state === "missing"
          ? `Needs ${result.missingCourses.map(formatCourseCode).join(", ") || "earlier prereqs"}`
          : state === "check"
            ? result.rawRequirements.join(" · ") || "Manual check"
            : "Prerequisites met";
      return {
        slot,
        label:
          slot.termId !== null
            ? (termInfo(slot.termId)?.label ?? slot.position)
            : slot.position,
        state,
        hint,
      };
    });
}

/**
 * Where the course already lives, as a human label, or null if it's not yet
 * placed. A course belongs in exactly one term; the picker uses this to show
 * an "already placed" banner and disable every option.
 */
export function alreadyInLabel(slots: PlanSlot[], code: string): string | null {
  const slot = slots.find((s) => s.courses.some((c) => c.code === code));
  if (!slot) return null;
  return slot.termId !== null
    ? (termInfo(slot.termId)?.label ?? "your plan")
    : "your plan";
}
