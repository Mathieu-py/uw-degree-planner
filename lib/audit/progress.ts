import { courseLevel, coursePrefix, levelBucket } from "@/lib/courses/code";
import { unitsMet } from "@/lib/format";
import { type Program, type RuleNode, walkRule } from "@/lib/programs";
import { type BreadthRequirement, deriveBreadthRequirements } from "./breadth";
import { deriveCommunicationRequirement } from "./communication";
import {
  type AuditNode,
  type AuditRoot,
  placementLegalityKey,
} from "./compile";
import { deriveElectiveSections, subjectPoolEligible } from "./electives";
import { deriveLevelFloors, type LevelFloor } from "./levelFloors";
import { maxBipartiteMatch } from "./matching";

/**
 * The degree headline as a single UNITS bar: `creditedUnits / totalUnits`.
 * Denominator = the degree's authoritative size (`unitPlan.totalUnits`);
 * numerator credits each placed course's units to at most one requirement,
 * plus the free-elective remainder, capped at total.
 *
 * Units, not a course count: courses aren't uniformly 0.5 unit (0.25 labs/PD,
 * 1.0 full-year), so a count never reconciles with the unit-defined size.
 * The denominator is one fixed number we only ASSIGN into and cap, so
 * redundant scraped rules can't push past 100%.
 */
export interface DegreeProgress {
  /** The degree's total units (the denominator), null when unknown. */
  totalUnits: number | null;
  /** Denominator actually used (= totalUnits, or the named-units fallback). */
  denom: number;
  /** Units credited — each placed course counted at most once, capped at denom. */
  creditedUnits: number;
  /** Headline 0–100, held below 100 until every requirement is met. */
  pct: number;
  /** Every volume bucket filled, all breadth + level floors met, nothing unverified. */
  allComplete: boolean;
  /** Free-elective room in the degree (units, ≥ 0). */
  freeUnits: number;
  /** Faculty breadth requirements ("1.0 unit of Humanities"), scored in units. */
  breadthRequirements: BreadthRequirement[];
  /** Faculty level-floor requirements ("X units at the 200-level+"), scored. */
  levelFloors: LevelFloor[];
}

/** A requirement that consumes real degree slots. */
interface Bucket {
  need: number;
  /** Placed course codes that qualify for it. */
  eligible: string[];
  /**
   * Units to reserve per UNFILLED slot (filled slots use real units). A
   * required course knows its exact units; a pool/pick/elective slot can't,
   * so ~0.5.
   */
  estimateUnit?: number;
}

/** Every course code appearing in `courses` leaves under a node (pick pools). */
function leafCodes(node: RuleNode, out: string[]): void {
  walkRule(node, (n) => {
    if (n.kind === "courses") out.push(...n.courses);
  });
}

/** Every `subjectPool` leaf under a node (a pick's options can be subject pools). */
function leafPools(
  node: RuleNode,
  out: Extract<RuleNode, { kind: "subjectPool" }>[],
): void {
  walkRule(node, (n) => {
    if (n.kind === "subjectPool") out.push(n);
  });
}

/** Does a placed code satisfy a subjectPool's prefix + level filters? */
function matchesPool(
  code: string,
  node: Extract<RuleNode, { kind: "subjectPool" }>,
): boolean {
  const prefix = coursePrefix(code);
  if (!node.subjectCodes.some((s) => s.toLowerCase() === prefix)) return false;
  const lvl = levelBucket(courseLevel(code));
  if (node.minLevel != null && lvl < node.minLevel) return false;
  if (node.maxLevel != null && lvl > node.maxLevel) return false;
  if (node.exclusions?.some((c) => c.toLowerCase() === code)) return false;
  return true;
}

/**
 * Walk a rule tree, collecting volume buckets and required-course codes.
 * `courses` under `all` are all-required (one singleton each); a `pick` unions
 * its descendant leaves into one pool; a `subjectPool` filters by prefix/level;
 * `excluded` is ignored.
 */
function collect(
  node: AuditNode,
  placed: ReadonlySet<string>,
  buckets: Bucket[],
  required: Set<string>,
): void {
  const r = node.ruleNode;
  switch (r.kind) {
    case "courses":
      for (const c of r.courses) required.add(c);
      break;
    case "pick": {
      // Collapse a pick's options into one bucket of `selectMin` slots. Options
      // can be subjectPools ("1 of: {3 SOC@400} or …"), so admit placed courses
      // matching any descendant pool too, else the pick is wrongly unsatisfiable.
      const codes: string[] = [];
      leafCodes(r, codes);
      const pools: Extract<RuleNode, { kind: "subjectPool" }>[] = [];
      leafPools(r, pools);
      const eligible = new Set(codes.filter((c) => placed.has(c)));
      for (const c of placed)
        if (pools.some((p) => matchesPool(c, p))) eligible.add(c);
      buckets.push({ need: r.selectMin ?? 0, eligible: [...eligible] });
      break;
    }
    case "subjectPool":
      buckets.push({
        need: r.selectCount,
        eligible: [...placed].filter((c) => matchesPool(c, r)),
      });
      break;
    case "all":
      for (const c of node.children) collect(c, placed, buckets, required);
      break;
    // excluded: never consumes slots.
  }
}

/** Codes barred by an `excluded` rule ("cannot be used towards this plan"). */
function collectExcluded(node: AuditNode, out: Set<string>): void {
  if (node.ruleNode.kind === "excluded")
    for (const c of node.ruleNode.courses) out.add(c);
  for (const c of node.children) collectExcluded(c, out);
}

/**
 * Compute the unified degree-progress headline.
 *
 * @param unitsOf units of a placed course (caller defaults unknown codes to 0.5).
 * @param legality slot-scoped keys of illegally-placed courses, from
 *   `legalityKeySet`. Excluded from credit so they never inflate the headline
 *   (still shown met-but-flagged on their row).
 */
export function computeDegreeProgress(
  audit: AuditRoot,
  program: Program | null,
  unitsOf: (code: string) => number,
  legality: ReadonlySet<string> = new Set(),
): DegreeProgress {
  const roots: (AuditNode | null)[] = [
    audit.flexibleRoot,
    audit.specializationRoot,
    ...(audit.byTerm ? Object.values(audit.byTerm) : []),
  ];

  // Drop illegally-placed courses before crediting: one placed before its
  // prereqs (or in antireq conflict) can't honestly count toward the degree.
  const illegalCodes = new Set<string>();
  if (legality.size > 0)
    for (const [code, p] of audit.placement)
      if (legality.has(placementLegalityKey(p))) illegalCodes.add(code);

  // Drop courses an `excluded` rule bars: they must never credit the headline
  // (named or free). They still surface as an excludedViolation on their row,
  // so this only stops silent inflation.
  const excludedCodes = new Set<string>();
  for (const root of roots) if (root) collectExcluded(root, excludedCodes);

  const placedList = [...audit.placement.keys()].filter(
    (c) => !illegalCodes.has(c) && !excludedCodes.has(c),
  );
  const placed = new Set(placedList);

  const buckets: Bucket[] = [];
  const required = new Set<string>();

  for (const root of roots) if (root) collect(root, placed, buckets, required);

  // Finite electives (consolidated upstream so overlapping pools count once)
  // and unit-based subject pools ("0.5 unit of BIOL/CHEM/… at 200+").
  if (program) {
    for (const e of deriveElectiveSections(program)) {
      if (e.kind === "finite")
        buckets.push({
          need: e.need,
          eligible: e.options.filter((c) => placed.has(c)),
        });
      else if (e.kind === "subjectPool")
        buckets.push({
          need: e.need,
          eligible: placedList.filter((c) => subjectPoolEligible(c, e)),
        });
    }

    // Communication — a pick-one named course. Skip when the rules already
    // include the option, else its units double-count.
    const comm = deriveCommunicationRequirement(program, placedList);
    if (comm && !comm.alreadyInTree)
      buckets.push({
        need: comm.need,
        eligible: comm.options.filter((c) => placed.has(c)),
      });
  }

  // Required courses → singleton buckets; each reserves its real catalog units.
  for (const code of required) {
    buckets.push({
      need: 1,
      eligible: placed.has(code) ? [code] : [],
      estimateUnit: unitsOf(code),
    });
  }

  // Optimal unique assignment of courses to slots (maxBipartiteMatch): each
  // matched course credits exactly one bucket, so overlapping pools can't
  // double-count and a satisfiable set is never left spuriously unfilled.
  const { filledByBucket, matched: used } = maxBipartiteMatch(buckets);

  // Roll up: real units of matched courses + per-slot estimate for unfilled
  // slots, so a 1.0-unit pick costs the free pool a full unit, not a flat 0.5.
  let namedCreditedUnits = 0;
  for (const code of used) namedCreditedUnits += unitsOf(code);
  let allBucketsFilled = true;
  let unfilledEstimate = 0;
  for (let bi = 0; bi < buckets.length; bi++) {
    const bk = buckets[bi];
    if (filledByBucket[bi] < bk.need) allBucketsFilled = false;
    unfilledEstimate +=
      (bk.need - filledByBucket[bi]) * (bk.estimateUnit ?? 0.5);
  }
  const namedUnits = namedCreditedUnits + unfilledEstimate;

  // Total units IS the denominator (exact). Free units are the remainder, so
  // named + free = total. Fall back to named units when total is unknown.
  const totalUnits = program?.unitPlan?.totalUnits ?? null;
  const denom = totalUnits ?? namedUnits;
  const freeUnits =
    totalUnits != null ? Math.max(0, totalUnits - namedUnits) : 0;

  // Leftover placed courses fill the genuine free-elective allotment only.
  let freeCreditedUnits = 0;
  for (const code of placedList) {
    if (used.has(code)) continue;
    if (freeCreditedUnits >= freeUnits) break;
    freeCreditedUnits += unitsOf(code);
  }
  freeCreditedUnits = Math.min(freeCreditedUnits, freeUnits);

  const creditedUnits = Math.min(namedCreditedUnits + freeCreditedUnits, denom);

  // Breadth is an independent filter (a course may satisfy breadth AND the
  // major), so it gates 100% without inflating the denominator. Tracked in
  // units, as the calendar states it.
  const breadthRequirements = program
    ? deriveBreadthRequirements(program, placedList, unitsOf)
    : [];
  const allBreadthMet = breadthRequirements.every((b) =>
    unitsMet(b.placedUnits, b.needUnits),
  );
  const unverifiedOwed = (program?.unverifiedRequirements?.length ?? 0) > 0;

  // Level floors ("X units at the 200-level+") gate completion like breadth:
  // an overlapping filter that blocks 100% without inflating the denominator.
  const levelFloors = program
    ? deriveLevelFloors(program, placedList, unitsOf)
    : [];
  const allFloorsMet = levelFloors.every((f) => unitsMet(f.placedUnits, f.need));

  const allComplete =
    allBucketsFilled && allBreadthMet && allFloorsMet && !unverifiedOwed;
  const raw = denom > 0 ? Math.round((creditedUnits / denom) * 100) : 0;
  const pct = allComplete ? Math.min(raw, 100) : Math.min(raw, 99);

  return {
    totalUnits,
    denom,
    creditedUnits,
    pct,
    allComplete,
    freeUnits,
    breadthRequirements,
    levelFloors,
  };
}
