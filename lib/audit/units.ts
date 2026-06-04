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
  MATH_SUBJECTS,
  type Program,
  type RuleNode,
  requiredSectionCodes,
  SCIENCE_SUBJECTS,
  TERM_LETTERS,
  type UnitBucket,
  type UnitConstraint,
  type UnitScope,
} from "@/lib/programs";
import { type BucketOrigin, bucketTitle } from "./labels";
import type { Placement, PlacementMap } from "./placement";

export type UnitOf = (code: string) => number | undefined;

/** Course-code prefixes that carry catalog units but never count toward degree
 *  units (Professional Development, co-op, work-term reports). */
const NON_ACADEMIC_PREFIXES = new Set(["pd", "coop", "wkrpt"]);

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
  isRequired: (code: string) => boolean,
): boolean {
  switch (scope.kind) {
    case "required":
      return isRequired(code);
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
      // Never auto-allocated (a bucket that survived `deriveBucketSubjects` as
      // unscoped has no verifiable scope). Known limitation: a course that
      // conceptually belongs to such a requirement instead flows into the open
      // free-electives bucket, so it's mis-attributed in the breakdown. The
      // headline is unaffected — unscoped units are excluded from the denominator
      // and surfaced as "verify manually" — and we can't redirect the course
      // without the scope we explicitly don't have, so this is left as-is.
      return false;
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

/** Every subject code named by a `subjectPool` anywhere in the rule tree. */
function rulePoolSubjects(program: Program): string[] {
  const out = new Set<string>();
  const walk = (n: RuleNode) => {
    if (n.kind === "subjectPool")
      for (const s of n.subjectCodes) out.add(s.toLowerCase());
    else if (n.kind === "all" || n.kind === "pick") n.children.forEach(walk);
  };
  if (program.kind === "engineering")
    for (const t of TERM_LETTERS) walk(program.terms[t]);
  else walk(program.rules);
  return [...out];
}

interface RulePool {
  subjects: string[];
  minLevel?: number;
  maxLevel?: number;
}

/** Every `subjectPool` in the rule tree, as subject/level matchers — the
 *  required-section "additional N units of SUBJ" pools the required bucket folds in. */
function collectRulePools(program: Program): RulePool[] {
  const out: RulePool[] = [];
  const walk = (n: RuleNode) => {
    if (n.kind === "subjectPool")
      out.push({
        subjects: n.subjectCodes.map((s) => s.toLowerCase()),
        minLevel: n.minLevel,
        maxLevel: n.maxLevel,
      });
    else if (n.kind === "all" || n.kind === "pick") n.children.forEach(walk);
  };
  if (program.kind === "engineering")
    for (const t of TERM_LETTERS) walk(program.terms[t]);
  else walk(program.rules);
  return out;
}

/** Subjects whose *concept* a bucket's noun names ("science" → SCIENCE, etc.). */
function nounConcepts(label: string): Set<string> {
  const allowed = new Set<string>();
  if (/\bscience\b/i.test(label))
    for (const s of SCIENCE_SUBJECTS) allowed.add(s);
  if (/\bmath(?:ematics)?\b/i.test(label))
    for (const s of MATH_SUBJECTS) allowed.add(s);
  return allowed;
}

/**
 * Recover a verifiable scope for ONE `unscoped` unit bucket. The bucket carries
 * reliable *units* but no machine-checkable scope; we recover it only when both
 * sources agree: the subject must (a) appear in the program's own rule-tree
 * subject pools (the authoritative "N courses from these subjects" lists), AND
 * (b) be corroborated by the bucket's noun via a documented concept set
 * ("Science and Mathematics" → SCIENCE_SUBJECTS ∪ MATH_SUBJECTS). That second
 * gate is the key guard: it keeps an off-topic pool (e.g. an ENGL humanities
 * pool) from leaking into a Science bucket. Subjects already owned by an explicit
 * subject bucket are excluded. Returns `[]` (→ stays unscoped, verify-manually)
 * when the noun names no known concept or nothing overlaps — e.g. arts-and-
 * business ("complete an Arts major") and "breadth courses".
 */
function deriveBucketSubjects(
  label: string,
  poolSubjects: readonly string[],
  claimed: ReadonlySet<string>,
): string[] {
  const allowed = nounConcepts(label);
  if (allowed.size === 0) return [];
  return poolSubjects.filter((s) => allowed.has(s) && !claimed.has(s));
}

/** A short title for a derived bucket, from its verbatim label ("…of X courses"). */
function nounTitle(label: string): string {
  return label.match(/\bof\s+(.+?\bcourses?)\b/i)?.[1] ?? label;
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

  // Recover a subject scope for `unscoped` buckets from the rule tree's pools
  // (psychology's "Science and Mathematics" → its Science + math pool subjects),
  // so those units become trackable instead of an unfillable black hole. Each
  // unscoped bucket is scoped from its OWN noun (not a shared union), so multiple
  // unscoped buckets never collide and an off-topic subject can't leak in. A
  // recovered bucket behaves as a normal subject bucket downstream; only its
  // title is taken from the verbatim label (the subject list reads poorly).
  const poolSubjects = rulePoolSubjects(program);
  const claimedSubjects = new Set(
    gathered.buckets.flatMap((b) =>
      b.bucket.scope.kind === "subject"
        ? b.bucket.scope.subjects.map((s) => s.toLowerCase())
        : [],
    ),
  );
  const derivedIds = new Set<string>();
  for (const b of gathered.buckets) {
    if (b.bucket.scope.kind !== "unscoped") continue;
    const subjects = deriveBucketSubjects(
      b.bucket.label,
      poolSubjects,
      claimedSubjects,
    );
    if (subjects.length === 0) continue; // no verifiable scope → stays unscoped
    derivedIds.add(b.bucket.id);
    b.bucket = { ...b.bucket, scope: { kind: "subject", subjects } };
  }

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

  // The "required courses" bucket counts the choice-group options too (its unit
  // total includes them), so its eligible set is the required-section codes —
  // all-required + choices — not the all-only `getRequiredCourses` set, which
  // would leave the bucket permanently unfillable. It ALSO counts the
  // required-section "additional N units of SUBJ" pools (e.g. "2.5 units of
  // additional ERS courses"), which the prose folds into the required total but
  // the tree expresses as subject pools — so a matching course fills it too.
  const requiredSet = requiredSectionCodes(program);
  const requiredPools = collectRulePools(program);
  const isRequired = (code: string): boolean => {
    if (requiredSet.has(code)) return true;
    const prefix = coursePrefix(code);
    const lvl = levelBucket(courseLevel(code));
    return requiredPools.some(
      (p) =>
        p.subjects.includes(prefix) &&
        (p.minLevel == null || lvl >= p.minLevel) &&
        (p.maxLevel == null || lvl <= p.maxLevel),
    );
  };
  const remaining = new Map(
    buckets.map((b) => [b.bucket.id, b.bucket.requiredUnits]),
  );
  const applied = new Map(buckets.map((b) => [b.bucket.id, 0]));
  const satisfiers = new Map<string, Placement[]>(
    buckets.map((b) => [b.bucket.id, []]),
  );

  const unknownUnitCourses: Placement[] = [];
  let totalApplied = 0;

  // Deterministic order so allocation is stable across runs. Non-academic
  // courses (PD, co-op, work-term reports) carry catalog weights but are
  // explicitly excluded from degree-unit totals, so drop them from all unit
  // accounting (total, allocation, and constraints).
  const placed = [...placement.entries()]
    .filter(([code]) => !NON_ACADEMIC_PREFIXES.has(coursePrefix(code)))
    .sort((a, b) => a[0].localeCompare(b[0]));

  for (const [code, p] of placed) {
    const units = unitOf(code);
    if (units == null) {
      unknownUnitCourses.push(p);
      continue;
    }
    totalApplied += units;

    const eligibleBuckets = buckets
      .filter((b) => eligible(b.bucket.scope, code, isRequired))
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
      // A derived bucket is now `subject`-scoped, but its subject list reads
      // poorly as a heading — keep the verbatim noun ("Science and Mathematics
      // courses") from its original label.
      title: derivedIds.has(bucket.id)
        ? nounTitle(bucket.label)
        : bucketTitle(bucket, origin),
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

  // Constraints are OVERLAPPING distribution checks over all placed courses
  // (faculty breadth, level minimums, "N units of PLAN at 300+"): a course can
  // satisfy a constraint and still fill its allocation bucket. We honor the
  // constraint's subject scope, exclusions, and level — so a HIST major's HIST
  // units satisfy the Humanities breadth, and "excluding SCI" really excludes it.
  const constraintAudits: UnitConstraintAudit[] = constraints.map(
    (constraint) => {
      const subjects = constraint.subjects?.map((s) => s.toLowerCase());
      const exclude = new Set(
        constraint.excludeSubjects?.map((s) => s.toLowerCase()),
      );
      let scopedUnits = 0;
      for (const [code] of placed) {
        const units = unitOf(code);
        if (units == null) continue;
        const prefix = coursePrefix(code);
        if (subjects && subjects.length > 0 && !subjects.includes(prefix))
          continue;
        if (exclude.has(prefix)) continue;
        if (
          constraint.minLevel != null &&
          levelBucket(courseLevel(code)) < constraint.minLevel
        )
          continue;
        scopedUnits += units;
      }
      scopedUnits = Math.round(scopedUnits * 100) / 100;
      return {
        constraint,
        // Cap at the requirement for a clean "X of Y" display.
        appliedUnits:
          constraint.minUnits != null
            ? Math.min(scopedUnits, constraint.minUnits)
            : scopedUnits,
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
