/**
 * Plan-level validations. Returns per-slot issues; the UI surfaces them as
 * inline badges on individual courses (prereq/antireq/coreq) and on the term
 * column header (overload).
 *
 * Strategy per validation:
 *  - Prereq: build the completed set of every slot STRICTLY before this
 *    slot's term, parse the course's prereq string with `parsePrereqs`,
 *    and run the existing `evaluate` engine. "uncertain" results (raw text /
 *    level expressions) are NOT flagged — they're surfaced as informational
 *    hints elsewhere in the audit.
 *  - Antireq: free-form course-code extraction from the antireq string. If
 *    ANY listed code appears anywhere in the plan (other than the course
 *    itself), flag both. This matches UW's convention that completing one
 *    of {X, Y} bars the other.
 *  - Coreq: parse the coreq string like prereqs, but evaluate against
 *    (completed-before-slot ∪ same-slot-courses) — coreqs allow either
 *    co-scheduled or previously-completed satisfiers.
 *  - Overload: academic slot has more than `ACADEMIC_TERM_CAP` courses.
 *
 * Co-op slots are skipped entirely (no overload, no per-course checks —
 * they don't have courses).
 */

import { parsePrereqs } from "../prereqs/parse";
import { evaluate } from "../prereqs/satisfied";
import type { Course } from "../types";
import { completedSetFromPlan } from "./derive";
import type { LocalPlan } from "./types";

export type ValidationKind = "prereq" | "antireq" | "coreq" | "overload";

export interface ValidationIssue {
  slotId: string;
  /** Course code the issue is about. Empty string for slot-level issues (overload). */
  courseCode: string;
  kind: ValidationKind;
  message: string;
}

export const ACADEMIC_TERM_CAP = 6;

export function validatePlan(
  plan: LocalPlan,
  catalogByCode: ReadonlyMap<string, Course>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const allPlacedCodes = new Set(
    plan.slots.flatMap((s) => s.courses.map((c) => c.code)),
  );

  for (const slot of plan.slots) {
    if (slot.isCoop) continue;

    if (slot.position !== "pre" && slot.courses.length > ACADEMIC_TERM_CAP) {
      issues.push({
        slotId: slot.id,
        courseCode: "",
        kind: "overload",
        message: `${slot.courses.length} courses scheduled (cap ${ACADEMIC_TERM_CAP}).`,
      });
    }

    const completedBefore =
      slot.termId !== null
        ? completedSetFromPlan(plan, slot.termId)
        : completedSetFromPlan(plan);
    const completedBeforeSet = new Set(completedBefore);
    const sameSlotCodes = new Set(slot.courses.map((c) => c.code));
    const coreqContext = new Set<string>([
      ...completedBeforeSet,
      ...sameSlotCodes,
    ]);

    for (const c of slot.courses) {
      const courseData = catalogByCode.get(c.code);
      if (!courseData) continue;

      // ---- Prereq ----
      if (courseData.prereqs) {
        const ast = parsePrereqs(courseData.prereqs);
        const result = evaluate(ast, { completed: completedBeforeSet });
        if (!result.satisfied) {
          const missing =
            result.missingCourses.length > 0
              ? result.missingCourses.slice(0, 3).join(", ")
              : "prereqs not met";
          issues.push({
            slotId: slot.id,
            courseCode: c.code,
            kind: "prereq",
            message: `Prereq missing: ${missing}`,
          });
        }
      }

      // ---- Antireq ----
      if (courseData.antireqs) {
        const antiCodes = extractCourseCodes(courseData.antireqs).filter(
          (a) => a !== c.code,
        );
        const collisions = antiCodes.filter((a) => allPlacedCodes.has(a));
        if (collisions.length > 0) {
          issues.push({
            slotId: slot.id,
            courseCode: c.code,
            kind: "antireq",
            message: `Antireq conflict: ${collisions.join(", ")}`,
          });
        }
      }

      // ---- Coreq ----
      if (courseData.coreqs) {
        const ast = parsePrereqs(courseData.coreqs);
        const result = evaluate(ast, { completed: coreqContext });
        if (!result.satisfied) {
          const missing =
            result.missingCourses.length > 0
              ? result.missingCourses.slice(0, 3).join(", ")
              : "coreqs not met";
          issues.push({
            slotId: slot.id,
            courseCode: c.code,
            kind: "coreq",
            message: `Coreq missing: ${missing}`,
          });
        }
      }
    }
  }
  return issues;
}

/**
 * Pull course codes out of a free-form requirement string. Matches sequences
 * like "ANTH 201", "MATH 137", "CS 246A" — letters followed by optional
 * whitespace and digits with an optional trailing letter. Returns lowercase
 * codes with whitespace stripped, deduplicated.
 */
export function extractCourseCodes(text: string): string[] {
  const re = /\b([A-Z]+)\s*(\d+[A-Z]*)\b/g;
  const out = new Set<string>();
  for (const m of text.matchAll(re)) {
    out.add(`${m[1]}${m[2]}`.toLowerCase());
  }
  return [...out];
}

/** Group issues by `slotId` for O(1) UI lookup. */
export function issuesBySlot(
  issues: ValidationIssue[],
): Map<string, ValidationIssue[]> {
  const map = new Map<string, ValidationIssue[]>();
  for (const i of issues) {
    const list = map.get(i.slotId);
    if (list) list.push(i);
    else map.set(i.slotId, [i]);
  }
  return map;
}

/** Group issues within a slot by course code, plus slot-level (empty code). */
export function issuesByCourseInSlot(slotIssues: ValidationIssue[]): {
  byCourse: Map<string, ValidationIssue[]>;
  slotLevel: ValidationIssue[];
} {
  const byCourse = new Map<string, ValidationIssue[]>();
  const slotLevel: ValidationIssue[] = [];
  for (const i of slotIssues) {
    if (i.courseCode === "") {
      slotLevel.push(i);
      continue;
    }
    const list = byCourse.get(i.courseCode);
    if (list) list.push(i);
    else byCourse.set(i.courseCode, [i]);
  }
  return { byCourse, slotLevel };
}
