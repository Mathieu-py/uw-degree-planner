/**
 * Which academic terms a course is eligible for — drives the audit panel's
 * drag highlight (eligible terms tint green, the rest mute). Only *guides* the
 * drop; `applyCourseDrop` still accepts any academic slot. Delegates per term
 * to the shared {@link evaluateCourseEligibility} so every surface agrees.
 */

import {
  type CourseEligibilityContext,
  evaluateCourseEligibility,
} from "@/lib/courses/courseEligibility";
import type { Course } from "@/lib/courses/types";
import type { ProgramIdentity } from "@/lib/programs";
import { completedSetFromPlan } from "./derive";
import type { LocalPlan } from "./types";

// A course with no catalog entry carries no constraints — eligible in every
// academic term (matches "uncatalogued = no prereqs").
function fallbackCourse(code: string): Course {
  return {
    id: 0,
    code,
    name: code,
    prereqs: null,
    coreqs: null,
    antireqs: null,
    rating: null,
    sections: [],
    prefix: "",
    level: 0,
    hasSeats: false,
  };
}

/**
 * Slot ids where `code` can be placed (never co-op or pre-arrival).
 * `referenced` = program-referenced codes, so a required course isn't blocked
 * by a stale restriction. A "check" term stays in; only a definitive
 * "ineligible" (failed prereq/level, antireq conflict, duplicate) drops a term.
 */
export function eligibleSlotIdsForCourse(
  plan: LocalPlan,
  code: string,
  catalogByCode: ReadonlyMap<string, Course>,
  program?: ProgramIdentity,
  referenced: ReadonlySet<string> = new Set(),
): Set<string> {
  const course = catalogByCode.get(code) ?? fallbackCourse(code);
  const placedAnywhere = completedSetFromPlan(plan);
  const out = new Set<string>();
  for (const slot of plan.slots) {
    // Only academic term columns accept drops — never co-op or pre-arrival.
    if (slot.isCoop || slot.position === "pre") continue;
    const ctx: CourseEligibilityContext = {
      completed:
        slot.termId !== null
          ? completedSetFromPlan(plan, slot.termId)
          : completedSetFromPlan(plan),
      sameTerm: new Set(slot.courses.map((c) => c.code)),
      // The slot's position is the student's level in this term ("1A".."4B").
      level: slot.position,
      program,
      programReferenced: referenced,
      placedAnywhere,
    };
    if (evaluateCourseEligibility(course, ctx).state !== "ineligible") {
      out.add(slot.id);
    }
  }
  return out;
}
