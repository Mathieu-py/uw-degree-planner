/**
 * Plan-level validations. Returns per-slot issues; the UI shows them as inline
 * badges on courses (prereq/antireq/coreq) and on the term header (overload).
 *
 * Per validation:
 *  - Prereq: evaluate parsed prereqs against everything completed STRICTLY
 *    before this slot's term. "uncertain" results (raw/level) aren't flagged here.
 *  - Antireq: extract codes from the antireq string; if any appears elsewhere
 *    in the plan, flag both (UW's "one of {X,Y} bars the other" convention).
 *  - Coreq: like prereqs, but evaluated against completed-before ∪ same-slot
 *    (coreqs allow co-scheduled or prior satisfiers).
 *  - Overload: academic slot exceeds `ACADEMIC_TERM_CAP` courses.
 *
 * Co-op slots are skipped entirely (they hold no courses).
 */

import type { Course } from "@/lib/courses/types";
import { formatCourseCode } from "@/lib/format";
import { cachedParsePrereqs } from "@/lib/prereqs/cache";
import { describeMissingPrereqs } from "@/lib/prereqs/describe";
import { evaluate } from "@/lib/prereqs/satisfied";
import { completedSetFromPlan } from "./derive";
import type { LocalPlan } from "./types";

type ValidationKind = "prereq" | "antireq" | "coreq" | "overload";

export interface ValidationIssue {
  slotId: string;
  /** Course code the issue is about. Empty string for slot-level issues (overload). */
  courseCode: string;
  kind: ValidationKind;
  message: string;
  /**
   * Antireq issues only: the placed codes this course conflicts with (lowercased),
   * so the audit can group a conflict and credit one member without re-parsing.
   */
  conflictsWith?: readonly string[];
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

  // Antireqs bar *degree credit* for both courses when EITHER names the other:
  // "Degree credit will not be granted for both the antirequisite course and a
  // course naming it as such" (UW calendar glossary). Raw lists are often
  // one-directional, so we flag symmetrically — precompute, per placed code, the
  // other placed codes that name it (the reverse direction its own list omits).
  const namedAsAntireqBy = new Map<string, Set<string>>();
  for (const code of allPlacedCodes) {
    const data = catalogByCode.get(code);
    if (!data?.antireqs) continue;
    for (const named of cachedExtractCourseCodes(data.antireqs)) {
      if (named === code || !allPlacedCodes.has(named)) continue;
      const set = namedAsAntireqBy.get(named) ?? new Set<string>();
      set.add(code);
      namedAsAntireqBy.set(named, set);
    }
  }

  for (const slot of plan.slots) {
    if (slot.isCoop) continue;
    // Pre-arrival transfer slots aren't real academic terms (often another
    // institution, where UW's prereq/antireq strings don't apply) — skip them.
    if (slot.position === "pre") continue;

    if (slot.courses.length > ACADEMIC_TERM_CAP) {
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
        const ast = cachedParsePrereqs(courseData.prereqs);
        const result = evaluate(ast, { completed: completedBeforeSet });
        if (!result.satisfied) {
          const missing =
            describeMissingPrereqs(ast, completedBeforeSet) ??
            "prereqs not met";
          issues.push({
            slotId: slot.id,
            courseCode: c.code,
            kind: "prereq",
            message: `Prereq missing: ${missing}`,
          });
        }
      }

      // ---- Antireq (symmetric: this course names a placed one, OR a placed
      //      one names this course) ----
      const forwardAnti = courseData.antireqs
        ? cachedExtractCourseCodes(courseData.antireqs).filter(
            (a) => a !== c.code && allPlacedCodes.has(a),
          )
        : [];
      const reverseAnti = namedAsAntireqBy.get(c.code);
      const collisions = [...new Set([...forwardAnti, ...(reverseAnti ?? [])])];
      if (collisions.length > 0) {
        issues.push({
          slotId: slot.id,
          courseCode: c.code,
          kind: "antireq",
          message: `Antireq conflict: ${collisions.map(formatCourseCode).join(", ")}`,
          conflictsWith: collisions,
        });
      }

      // ---- Coreq ----
      if (courseData.coreqs) {
        const ast = cachedParsePrereqs(courseData.coreqs);
        const result = evaluate(ast, { completed: coreqContext });
        if (!result.satisfied) {
          const missing =
            describeMissingPrereqs(ast, coreqContext) ?? "coreqs not met";
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
 * Pull course codes out of a free-form requirement string ("ANTH 201",
 * "CS 246A"): letters + optional space + digits + optional trailing letter.
 * Returns lowercase, whitespace-stripped, deduped codes. Case-insensitive.
 */
export function extractCourseCodes(text: string): string[] {
  const re = /\b([A-Za-z]+)\s*(\d+[A-Z]*)\b/gi;
  const out = new Set<string>();
  for (const m of text.matchAll(re)) {
    out.add(`${m[1]}${m[2]}`.toLowerCase());
  }
  return [...out];
}

const extractCache = new Map<string, readonly string[]>();

/**
 * Memoized {@link extractCourseCodes}, keyed on the raw string. Eligibility
 * re-checks antireqs for many rows on every picker keystroke, so this avoids
 * re-running the regex over thousands of strings.
 */
export function cachedExtractCourseCodes(
  text: string | null | undefined,
): readonly string[] {
  const key = text ?? "";
  const hit = extractCache.get(key);
  if (hit) return hit;
  const out = text ? extractCourseCodes(text) : [];
  extractCache.set(key, out);
  return out;
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
