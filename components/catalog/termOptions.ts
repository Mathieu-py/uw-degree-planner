import { useMemo } from "react";
import {
  type CourseEligibilityContext,
  evaluateCourseEligibility,
  isProgramBlocked,
} from "@/lib/courses/courseEligibility";
import type { Course } from "@/lib/courses/types";
import {
  completedSetFromPlan,
  isAcademicSlot,
  placedCourseLabel,
} from "@/lib/plan/derive";
import type { PlanSlot } from "@/lib/plan/types";
import type { ProgramIdentity } from "@/lib/programs";
import { usePlanProgramContext } from "@/lib/programs/usePlanPrograms";
import { termInfo } from "@/lib/terms";

export type TermState = "eligible" | "check" | "missing";

export interface TermOption {
  slot: PlanSlot;
  label: string;
  state: TermState;
  hint: string;
}

/**
 * Per-term eligibility for adding `course`, across every academic term: a course
 * is "missing" early and turns "eligible" once its prereqs sit in earlier terms.
 * Pure and plan-shape-agnostic (reads only `slots`); pre-arrival and co-op slots
 * are excluded. Delegates to {@link evaluateCourseEligibility}.
 */
export function computeTermOptions(
  slots: PlanSlot[],
  course: Course,
  programs: ProgramIdentity[],
  programReferenced: ReadonlySet<string>,
  placedAnywhere: ReadonlySet<string>,
): TermOption[] {
  return slots.filter(isAcademicSlot).map((slot) => {
    const ctx: CourseEligibilityContext = {
      completed: completedSetFromPlan({ slots }, slot.termId ?? undefined),
      sameTerm: new Set(slot.courses.map((c) => c.code)),
      level: slot.position,
      programs,
      programReferenced,
      placedAnywhere,
    };
    const verdict = evaluateCourseEligibility(course, ctx);
    const state: TermState =
      verdict.state === "ineligible"
        ? "missing"
        : verdict.state === "check"
          ? "check"
          : "eligible";
    const hint =
      state === "eligible"
        ? "Prerequisites met"
        : verdict.reasons.join(" · ") ||
          (state === "check" ? "Manual check" : "Needs earlier prereqs");
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
 * Where the course already lives, as a human label, or null if unplaced. The
 * picker uses this to show an "already placed" banner and disable every option.
 */
export function alreadyInLabel(slots: PlanSlot[], code: string): string | null {
  const slot = slots.find((s) => s.courses.some((c) => c.code === code));
  if (!slot) return null;
  return slot.termId !== null
    ? (termInfo(slot.termId)?.label ?? "your plan")
    : "your plan";
}

/**
 * Shared hook behind every course→term "add" surface: {@link computeTermOptions}
 * + {@link placedCourseLabel} (twin-aware), plus a plan-level `blocked` flag (a
 * program block is term-independent, so callers surface it once, not per term).
 * `slots` is nullable so callers can render before the plan loads.
 */
export function useTermOptions(
  course: Course,
  slots: PlanSlot[] | null | undefined,
  plan?: {
    programIds: string[];
    specializationIds: Record<string, string>;
  } | null,
): { options: TermOption[]; alreadyIn: string | null; blocked: boolean } {
  const { programs, programReferenced } = usePlanProgramContext(plan);
  const placedAnywhere = useMemo(
    () => new Set((slots ?? []).flatMap((s) => s.courses.map((c) => c.code))),
    [slots],
  );
  const options = useMemo(
    () =>
      slots
        ? computeTermOptions(
            slots,
            course,
            programs,
            programReferenced,
            placedAnywhere,
          )
        : [],
    [slots, course, programs, programReferenced, placedAnywhere],
  );
  // Plan-level (not per-term); a null plan (loading / no plan) can't be blocked.
  const programBlocked = useMemo(
    () =>
      plan != null && isProgramBlocked(course, { programs, programReferenced }),
    [plan, course, programs, programReferenced],
  );
  // Twin-aware (see placedCourseLabel): a placed cross-listed member also gates.
  const alreadyIn = slots ? placedCourseLabel(slots, course) : null;
  // Already-placed outranks a program block (matches evaluateCourseEligibility):
  // a placed-but-blocked course reads "already placed", not "not open".
  const blocked = alreadyIn === null && programBlocked;
  return { options, alreadyIn, blocked };
}
