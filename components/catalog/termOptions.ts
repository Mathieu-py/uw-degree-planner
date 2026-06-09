import { useMemo } from "react";
import {
  type CourseEligibilityContext,
  evaluateCourseEligibility,
} from "@/lib/courses/courseEligibility";
import type { Course } from "@/lib/courses/types";
import { completedSetFromPlan } from "@/lib/plan/derive";
import type { PlanSlot } from "@/lib/plan/types";
import {
  type ProgramIdentity,
  programIdentities,
  programReferencedCodes,
} from "@/lib/programs";
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
  return slots
    .filter((s) => s.position !== "pre" && !s.isCoop)
    .map((slot) => {
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
 * Shared hook behind every course→term "add" surface: derives
 * {@link computeTermOptions} + {@link alreadyInLabel}. `slots` is nullable so
 * callers can render before the plan loads (options stay empty until it does).
 */
export function useTermOptions(
  course: Course,
  slots: PlanSlot[] | null | undefined,
  plan?: {
    programIds: string[];
    specializationIds: Record<string, string>;
  } | null,
): { options: TermOption[]; alreadyIn: string | null } {
  const code = course.code.toLowerCase();
  // Identities + referenced-codes span every program (double degree), so a
  // course relevant to — or restricted to — either degree resolves right.
  // (`programIds` ref is stable across slot edits, so it's a sound memo dep.)
  const programs = useMemo(
    () => programIdentities(plan?.programIds, plan?.specializationIds),
    [plan?.programIds, plan?.specializationIds],
  );
  const programReferenced = useMemo(() => {
    const ids = plan?.programIds ?? [];
    if (ids.length <= 1)
      return programReferencedCodes(
        ids[0],
        ids[0] ? plan?.specializationIds?.[ids[0]] : null,
      );
    const out = new Set<string>();
    ids.forEach((id) => {
      // Each program contributes its own specialization's referenced codes.
      const codes = programReferencedCodes(id, plan?.specializationIds?.[id]);
      for (const c of codes) out.add(c);
    });
    return out;
  }, [plan?.programIds, plan?.specializationIds]);
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
  const alreadyIn = slots ? alreadyInLabel(slots, code) : null;
  return { options, alreadyIn };
}
