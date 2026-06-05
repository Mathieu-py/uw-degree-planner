/**
 * Unit-weighted grade averages over a plan. Waterloo reports PERCENTAGE
 * averages (not a 4.0 GPA), so each is the units-weighted mean of the numeric
 * grades on placed courses:  Σ(grade × units) / Σ(units).
 *
 *  - Cumulative: every numerically-graded course in an academic term.
 *  - Major: only courses the program's own rules credit (from the audit tree) —
 *    not breadth, electives, or specialization.
 *
 * What's deliberately simple in v1 (documented, not hidden):
 *  - Transfer credits (the `pre` slot) carry no numeric grade and are excluded.
 *  - A repeated course counts once — the most recent placement (last in slot
 *    order). Faculty rules on which attempt counts are out of scope here.
 *  - A course with unknown catalog units is weighted at 0.5 (the common case).
 *  - Below {@link MIN_GRADED_FOR_AVERAGE} graded courses the value is `null`
 *    ("not yet computable") rather than a misleading near-empty average.
 */

import type { Course } from "@/lib/courses/types";
import { numericPercent } from "@/lib/plan/grades";
import type { LocalPlan } from "@/lib/plan/types";
import type { AuditNode, AuditRoot } from "./compile";

const DEFAULT_UNITS = 0.5;
export const MIN_GRADED_FOR_AVERAGE = 3;

export interface Average {
  /** Unit-weighted mean percentage, or null when not yet computable. */
  value: number | null;
  /** How many numerically-graded courses contributed. */
  countedCourses: number;
  /** Total units behind the average. */
  units: number;
}

export interface Averages {
  cumulative: Average;
  major: Average;
}

interface GradedCourse {
  code: string;
  percent: number;
  units: number;
}

/** Numerically-graded academic courses, deduped by code (most recent wins). */
function gradedCourses(
  plan: LocalPlan,
  catalogByCode: ReadonlyMap<string, Course>,
): GradedCourse[] {
  const byCode = new Map<string, GradedCourse>();
  for (const slot of plan.slots) {
    if (slot.position === "pre") continue; // transfer credits — no numeric grade
    for (const c of slot.courses) {
      const percent = numericPercent(c.grade);
      if (percent === null) continue;
      const units = catalogByCode.get(c.code)?.units ?? DEFAULT_UNITS;
      // Slots iterate in sequence order, so a later entry is the more recent
      // attempt; let it overwrite an earlier one.
      byCode.set(c.code, { code: c.code, percent, units });
    }
  }
  return [...byCode.values()];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function weightedAverage(courses: readonly GradedCourse[]): Average {
  let weighted = 0;
  let units = 0;
  for (const c of courses) {
    weighted += c.percent * c.units;
    units += c.units;
  }
  const computable = courses.length >= MIN_GRADED_FOR_AVERAGE && units > 0;
  return {
    value: computable ? round1(weighted / units) : null,
    countedCourses: courses.length,
    units,
  };
}

function collectSatisfierCodes(node: AuditNode, into: Set<string>): void {
  for (const s of node.satisfiers) into.add(s.code);
  for (const c of node.children) collectSatisfierCodes(c, into);
}

/** Codes credited by the program's OWN rules (engineering terms / flexible root). */
export function majorCourseCodes(audit: AuditRoot): Set<string> {
  const set = new Set<string>();
  if (audit.byTerm)
    for (const t of Object.values(audit.byTerm)) collectSatisfierCodes(t, set);
  if (audit.flexibleRoot) collectSatisfierCodes(audit.flexibleRoot, set);
  return set;
}

export function computeAverages(
  plan: LocalPlan,
  catalogByCode: ReadonlyMap<string, Course>,
  audit: AuditRoot,
): Averages {
  const graded = gradedCourses(plan, catalogByCode);
  const majorCodes = majorCourseCodes(audit);
  return {
    cumulative: weightedAverage(graded),
    major: weightedAverage(graded.filter((c) => majorCodes.has(c.code))),
  };
}
