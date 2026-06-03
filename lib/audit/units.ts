/**
 * Unit accounting — the exact UW degree model. Where `compile.ts` audits the
 * course-count rule tree, this audits the *unit* plan: a degree's total units
 * split into buckets ("9.0 required + 7.0 BIOL + 5.5 elective"), plus unit
 * constraints ("min 14.5 units at the 200-level").
 *
 * Each placed course's catalog units are allocated to exactly one bucket
 * (a unit can't count twice), most-specific bucket first so required courses
 * fill the "required" bucket, subject courses fill their subject bucket, and
 * whatever's left flows into the open "free electives" bucket. Courses with no
 * known unit weight are surfaced separately rather than silently dropped.
 */

import { courseLevel, coursePrefix, levelBucket } from "@/lib/courses/code";
import {
  getRequiredCourses,
  type Program,
  type UnitBucket,
  type UnitConstraint,
  type UnitScope,
} from "@/lib/programs";
import type { Placement, PlacementMap } from "./placement";

export type UnitOf = (code: string) => number | undefined;

export type UnitStatus = "met" | "partial" | "unmet";

export interface UnitBucketAudit {
  bucket: UnitBucket;
  appliedUnits: number;
  satisfiers: Placement[];
  status: UnitStatus;
}

export interface UnitConstraintAudit {
  constraint: UnitConstraint;
  /** Units that meet the constraint's scope (e.g. units at the 200-level+). */
  appliedUnits: number;
  satisfied: boolean;
}

export interface UnitAudit {
  buckets: UnitBucketAudit[];
  constraints: UnitConstraintAudit[];
  /** Degree total, if the program states one. */
  totalRequired?: number;
  /** Sum of all placed courses' known units. */
  totalApplied: number;
  /** Placed courses we couldn't weight (not in the catalog units map). */
  unknownUnitCourses: Placement[];
}

/** Higher = more specific; a course fills its most specific eligible bucket. */
function specificity(scope: UnitScope): number {
  switch (scope.kind) {
    case "list":
      return 3;
    case "required":
      return 2;
    case "subject":
      return 1;
    case "subjectExcept":
      return 1;
    case "open":
      return 0;
  }
}

function eligible(
  scope: UnitScope,
  code: string,
  requiredSet: ReadonlySet<string>,
): boolean {
  switch (scope.kind) {
    case "required":
      return requiredSet.has(code);
    case "list":
      return scope.courses.includes(code);
    case "subject": {
      const subjects = scope.subjects.map((s) => s.toLowerCase());
      if (!subjects.includes(coursePrefix(code))) return false;
      if (
        scope.minLevel != null &&
        levelBucket(courseLevel(code)) < scope.minLevel
      )
        return false;
      return true;
    }
    case "subjectExcept": {
      const exclude = scope.exclude.map((s) => s.toLowerCase());
      if (exclude.includes(coursePrefix(code))) return false;
      if (
        scope.minLevel != null &&
        levelBucket(courseLevel(code)) < scope.minLevel
      )
        return false;
      return true;
    }
    case "open":
      return true;
  }
}

function bucketStatus(applied: number, required: number): UnitStatus {
  if (applied >= required) return "met";
  return applied > 0 ? "partial" : "unmet";
}

/** Gather a program's unit buckets + constraints (its own plan + degree-level). */
function gatherPlan(program: Program): {
  buckets: UnitBucket[];
  constraints: UnitConstraint[];
  totalRequired?: number;
} {
  return {
    buckets: [
      ...(program.unitPlan?.buckets ?? []),
      ...(program.degreeRequirements?.buckets ?? []),
    ],
    constraints: [
      ...(program.unitPlan?.constraints ?? []),
      ...(program.degreeRequirements?.constraints ?? []),
    ],
    totalRequired: program.unitPlan?.totalUnits,
  };
}

/**
 * Allocate placed-course units across a program's unit buckets and evaluate its
 * unit constraints. Returns `null` when the program carries no unit plan (so
 * callers fall back to the course-count audit).
 */
export function compileUnits(
  program: Program,
  placement: PlacementMap,
  unitOf: UnitOf,
): UnitAudit | null {
  const { buckets, constraints, totalRequired } = gatherPlan(program);
  if (buckets.length === 0 && constraints.length === 0) return null;

  const requiredSet = new Set(getRequiredCourses(program));
  const remaining = new Map(buckets.map((b) => [b.id, b.requiredUnits]));
  const applied = new Map(buckets.map((b) => [b.id, 0]));
  const satisfiers = new Map<string, Placement[]>(
    buckets.map((b) => [b.id, []]),
  );

  const unknownUnitCourses: Placement[] = [];
  let totalApplied = 0;

  // Deterministic order so allocation is stable across runs.
  const placed = [...placement.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  for (const [code, p] of placed) {
    const units = unitOf(code);
    if (units == null) {
      unknownUnitCourses.push(p);
      continue;
    }
    totalApplied += units;

    const eligibleBuckets = buckets
      .filter((b) => eligible(b.scope, code, requiredSet))
      .sort((a, b) => specificity(b.scope) - specificity(a.scope));
    // Prefer a bucket that still needs units; else the most specific eligible
    // one (overflow, still surfaced as a satisfier so the course isn't "lost").
    const target =
      eligibleBuckets.find((b) => (remaining.get(b.id) ?? 0) > 0) ??
      eligibleBuckets[0];
    if (!target) continue; // counts toward the degree total only

    applied.set(target.id, (applied.get(target.id) ?? 0) + units);
    remaining.set(
      target.id,
      Math.max(0, (remaining.get(target.id) ?? 0) - units),
    );
    satisfiers.get(target.id)?.push(p);
  }

  const bucketAudits: UnitBucketAudit[] = buckets.map((bucket) => {
    const a = applied.get(bucket.id) ?? 0;
    return {
      bucket,
      appliedUnits: a,
      satisfiers: satisfiers.get(bucket.id) ?? [],
      status: bucketStatus(a, bucket.requiredUnits),
    };
  });

  const constraintAudits: UnitConstraintAudit[] = constraints.map(
    (constraint) => {
      let scopedUnits = 0;
      for (const [code, p] of placed) {
        const units = unitOf(code);
        if (units == null) continue;
        if (
          constraint.minLevel != null &&
          levelBucket(courseLevel(code)) < constraint.minLevel
        )
          continue;
        scopedUnits += units;
        void p;
      }
      return {
        constraint,
        appliedUnits: scopedUnits,
        satisfied:
          constraint.minUnits == null || scopedUnits >= constraint.minUnits,
      };
    },
  );

  return {
    buckets: bucketAudits,
    constraints: constraintAudits,
    totalRequired,
    totalApplied,
    unknownUnitCourses,
  };
}
