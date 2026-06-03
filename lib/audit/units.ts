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
import { type BucketOrigin, bucketTitle } from "./labels";
import type { Placement, PlacementMap } from "./placement";

export type UnitOf = (code: string) => number | undefined;

export type UnitStatus = "met" | "partial" | "unmet";

export interface UnitBucketAudit {
  bucket: UnitBucket;
  /** Concise section title derived from the bucket's scope/origin. */
  title: string;
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
  /**
   * Sum of units actually allocated to a bucket (= Σ bucket.appliedUnits). This
   * is the honest headline numerator: unlike `totalApplied`, it excludes units
   * that landed in no bucket (unscoped requirements, which we never auto-fill,
   * and overflow once every eligible bucket is full), so the headline can't read
   * 100% while an unscoped bucket still says "verify manually".
   */
  allocatedUnits: number;
  /** Units in `unscoped` buckets the student must verify by hand. */
  unscopedUnits: number;
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
    case "unscoped":
      return -1;
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
    case "unscoped":
      return false; // never auto-allocated; counts toward the total only
  }
}

function bucketStatus(applied: number, required: number): UnitStatus {
  if (applied >= required) return "met";
  return applied > 0 ? "partial" : "unmet";
}

/** A bucket plus where it came from (its own plan vs the faculty degree page). */
interface OriginBucket {
  bucket: UnitBucket;
  origin: BucketOrigin;
}

/** Gather a program's unit buckets + constraints (its own plan + degree-level). */
function gatherPlan(program: Program): {
  buckets: OriginBucket[];
  constraints: UnitConstraint[];
  totalRequired?: number;
} {
  return {
    buckets: [
      ...(program.unitPlan?.buckets ?? []).map((bucket) => ({
        bucket,
        origin: "program" as const,
      })),
      ...(program.degreeRequirements?.buckets ?? []).map((bucket) => ({
        bucket,
        origin: "degree" as const,
      })),
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
  const gathered = gatherPlan(program);
  const { constraints } = gathered;

  // Free electives = degree total − the specific (non-open) bucket
  // requirements. UW states this implicitly, so we make a single free-electives
  // bucket the *balance* of the total — that's the only way the Degree-units add
  // up to the headline. We only synthesize it when there are real specific
  // buckets to complement: a program with a total but *no* buckets (e.g. a
  // lockstep engineering degree) isn't a unit-distribution program, so inventing
  // a whole-degree "Free electives" bucket would be meaningless. When the
  // specific buckets already meet/exceed the total (double degrees whose true
  // total we couldn't source), the propagated total is unreliable, so drop it
  // and show the buckets without a headline total.
  let totalRequired = gathered.totalRequired;
  const specific = gathered.buckets.filter(
    (b) => b.bucket.scope.kind !== "open",
  );
  let buckets = gathered.buckets;
  if (totalRequired != null && specific.length > 0) {
    const specificSum = specific.reduce(
      (s, b) => s + b.bucket.requiredUnits,
      0,
    );
    const free = Math.round((totalRequired - specificSum) * 100) / 100;
    if (free > 0.01) {
      buckets = [
        ...specific,
        {
          bucket: {
            id: "free-electives",
            label: "Free electives",
            requiredUnits: free,
            scope: { kind: "open" },
            sourceText: `${free} units of free electives toward the ${totalRequired}-unit degree`,
          },
          origin: "program",
        },
      ];
    } else if (free < -0.01) {
      totalRequired = undefined; // total can't be trusted; show buckets only
    } else {
      buckets = specific; // exactly filled; drop any zero-size open bucket
    }
  }
  // A program is unit-based when it states a total, carries buckets, or has unit
  // constraints; otherwise it's course-count only and callers fall back.
  if (buckets.length === 0 && constraints.length === 0 && totalRequired == null)
    return null;

  const requiredSet = new Set(getRequiredCourses(program));
  const remaining = new Map(
    buckets.map((b) => [b.bucket.id, b.bucket.requiredUnits]),
  );
  const applied = new Map(buckets.map((b) => [b.bucket.id, 0]));
  const satisfiers = new Map<string, Placement[]>(
    buckets.map((b) => [b.bucket.id, []]),
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
      .filter((b) => eligible(b.bucket.scope, code, requiredSet))
      .sort(
        (a, b) => specificity(b.bucket.scope) - specificity(a.bucket.scope),
      );
    // Fill the most specific eligible bucket that still needs units. If every
    // eligible bucket is already full, don't over-fill one — the units still
    // count toward the degree total (excess flows to free electives / overflow).
    const target = eligibleBuckets.find(
      (b) => (remaining.get(b.bucket.id) ?? 0) > 0,
    );
    if (!target) continue; // counts toward the degree total only

    applied.set(target.bucket.id, (applied.get(target.bucket.id) ?? 0) + units);
    remaining.set(
      target.bucket.id,
      Math.max(0, (remaining.get(target.bucket.id) ?? 0) - units),
    );
    satisfiers.get(target.bucket.id)?.push(p);
  }

  const bucketAudits: UnitBucketAudit[] = buckets.map(({ bucket, origin }) => {
    const a = applied.get(bucket.id) ?? 0;
    return {
      bucket,
      title: bucketTitle(bucket, origin),
      appliedUnits: a,
      satisfiers: satisfiers.get(bucket.id) ?? [],
      status: bucketStatus(a, bucket.requiredUnits),
    };
  });

  const allocatedUnits =
    Math.round(bucketAudits.reduce((s, b) => s + b.appliedUnits, 0) * 100) /
    100;
  const unscopedUnits =
    Math.round(
      buckets
        .filter(({ bucket }) => bucket.scope.kind === "unscoped")
        .reduce((s, { bucket }) => s + bucket.requiredUnits, 0) * 100,
    ) / 100;

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
    allocatedUnits,
    unscopedUnits,
    unknownUnitCourses,
  };
}
