import { useMemo } from "react";
import type { Course } from "@/lib/courses/types";
import { formatCourseCode } from "@/lib/format";
import { completedSetFromPlan } from "@/lib/plan/derive";
import type { PlanSlot } from "@/lib/plan/types";
import { type PrereqNode, parsePrereqs } from "@/lib/prereqs/parse";
import { evaluate } from "@/lib/prereqs/satisfied";
import { type ProgramIdentity, programIdentity } from "@/lib/programs";
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
  program?: ProgramIdentity,
): TermOption[] {
  return slots
    .filter((s) => s.position !== "pre" && !s.isCoop)
    .map((slot) => {
      const completed = completedSetFromPlan(
        { slots },
        slot.termId ?? undefined,
      );
      const result = evaluate(prereqNode, {
        completed,
        level: slot.position,
        program,
      });
      const state: TermState = !result.satisfied
        ? "missing"
        : result.uncertain
          ? "check"
          : "eligible";
      const hint =
        state === "missing"
          ? result.missingCourses.length > 0
            ? `Needs ${result.missingCourses.map(formatCourseCode).join(", ")}`
            : // No missing course → a program restriction blocked it.
              result.rawRequirements.join(" · ") || "Needs earlier prereqs"
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

/**
 * Shared derivation behind every course→term "add" surface (catalog local +
 * server bodies, planner audit drill-in): parse the course's prereqs once, then
 * derive the per-term {@link computeTermOptions} and {@link alreadyInLabel}.
 * `slots` is nullable so callers can render before the plan loads — options
 * stay empty until it arrives.
 */
export function useTermOptions(
  course: Course,
  slots: PlanSlot[] | null | undefined,
  plan?: { programId: string | null; specializationId: string | null } | null,
): { options: TermOption[]; alreadyIn: string | null } {
  const code = course.code.toLowerCase();
  const prereqNode = useMemo(
    () => parsePrereqs(course.prereqs),
    [course.prereqs],
  );
  const program = useMemo(
    () => programIdentity(plan?.programId, plan?.specializationId) ?? undefined,
    [plan?.programId, plan?.specializationId],
  );
  const options = useMemo(
    () => (slots ? computeTermOptions(slots, prereqNode, program) : []),
    [slots, prereqNode, program],
  );
  const alreadyIn = slots ? alreadyInLabel(slots, code) : null;
  return { options, alreadyIn };
}
