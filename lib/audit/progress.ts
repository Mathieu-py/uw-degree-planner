import { poolMatch } from "@/lib/courses/code";
import {
  EMPTY_EQUIVALENCE,
  type EquivalenceIndex,
} from "@/lib/courses/equivalence";
import { unitsMet } from "@/lib/format";
import { flatCoursePickOptions, type Program } from "@/lib/programs";
import { type BreadthRequirement, deriveBreadthRequirements } from "./breadth";
import { deriveCommunicationRequirement } from "./communication";
import {
  type AuditNode,
  type AuditRoot,
  isSatisfied,
  splitPlacementByLegality,
  subjectPoolNodeFilter,
} from "./compile";
import {
  deriveElectiveSections,
  type ElectiveSection,
  subjectPoolFilter,
} from "./electives";
import { deriveLevelFloors, type LevelFloor } from "./levelFloors";
import {
  assignUnitPools,
  type MatchResult,
  maxBipartiteMatch,
} from "./matching";

/**
 * The degree headline as a single UNITS bar: `creditedUnits / totalUnits`.
 * Units, not a course count — courses aren't uniformly 0.5 (0.25 labs, 1.0
 * full-year). The denominator is one fixed number credit is only ASSIGNED
 * into and capped at, so redundant scraped rules can't push past 100%.
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
  /** Structured reqs done (buckets + breadth/floors + nothing unverified). Can
   *  hold with free-elective units unplaced — "fully done" is `pct === 100`. */
  allComplete: boolean;
  /** Free-elective room in the degree (units, ≥ 0). */
  freeUnits: number;
  /** Faculty breadth requirements ("1.0 unit of Humanities"), scored in units. */
  breadthRequirements: BreadthRequirement[];
  /** Faculty level-floor requirements ("X units at the 200-level+"), scored. */
  levelFloors: LevelFloor[];
  /** Unacknowledged `unverifiedRequirements` — non-empty holds the headline
   *  below 100%; surfaced near it so "check with your advisor" is actionable. */
  owedUnverified: string[];
  /** Per-node filled-slot counts from the global match (keyed by node
   *  identity): rows read the SAME one-course-per-slot credit as the headline,
   *  so an overlapping pool shows unmet once named requirements claim its courses. */
  nodeFill: NodeFill;
  /** Per-elective match credit, index-aligned to `deriveElectiveSections`
   *  (filled count / credited units; sparse — no entry for "browse"). */
  electiveCredit: number[];
  /** The codes behind `nodeFill`'s counts, per node — a row chips exactly what
   *  credits it, not a course another requirement claimed. */
  nodeAssigned: NodeAssigned;
  /** Match credit of the communication bucket (absent when none, or in-tree) —
   *  keeps the minimums row honest when another bucket claimed the course. */
  commCredit?: number;
}

/** Filled-slot count per owning rule-tree node (see {@link DegreeProgress.nodeFill}). */
export type NodeFill = WeakMap<AuditNode, number>;

/** Assigned course codes per owning rule-tree node (see {@link DegreeProgress.nodeAssigned}). */
export type NodeAssigned = WeakMap<AuditNode, string[]>;

/** A requirement that consumes real degree slots. */
interface Bucket {
  need: number;
  /** Placed course codes that qualify for it. */
  eligible: string[];
  /** Claim priority for tied assignments (see `MatchBucket.rank`, matching.ts). */
  rank?: number;
  /** Units reserved per UNFILLED slot (filled slots use real units): exact for
   *  a required course, ~0.5 for pool/pick/elective slots. */
  estimateUnit?: number;
  /** Owning rule-tree node (elective/communication buckets have none); its
   *  filled total feeds `nodeFill`, so rows share the headline's credit. */
  owner?: AuditNode;
}

/** A units-scored requirement (unit-stated `subjectPool` or elective unit pool):
 *  a 1.0-unit course counts 1.0, unlike a count {@link Bucket}. `owner` is set
 *  for rule-tree pools so their row matches the headline. */
interface UnitPool {
  needUnits: number;
  eligible: string[];
  owner?: AuditNode;
}

/** The shared unit weight of the option codes, or undefined when mixed/empty.
 *  An unfilled 1.0-unit pick must reserve 1.0, not a flat 0.5, or free-elective
 *  room is overstated; mixed weights fall back to the 0.5 default. */
function uniformUnit(
  codes: readonly string[],
  unitsOf: (code: string) => number,
): number | undefined {
  let u: number | undefined;
  for (const c of codes) {
    const v = unitsOf(c);
    if (u === undefined) u = v;
    else if (u !== v) return undefined;
  }
  return u;
}

/**
 * Walk a rule tree, collecting volume buckets and required-course codes:
 * `courses` under `all` are all-required, `subjectPool` filters by prefix/level,
 * `excluded` is ignored, picks mirror {@link compilePick}. `placedMatches` maps
 * a code to its placed self/cross-listed twins, so each course counts once.
 */
function collect(
  node: AuditNode,
  placed: ReadonlySet<string>,
  placedMatches: (code: string) => string[],
  buckets: Bucket[],
  unitPools: UnitPool[],
  required: Map<string, AuditNode>,
  unitsOf: (code: string) => number,
): void {
  const r = node.ruleNode;
  switch (r.kind) {
    case "courses":
      // First leaf naming a code owns its singleton bucket (first-wins keeps
      // the owner stable).
      for (const c of r.courses) if (!required.has(c)) required.set(c, node);
      break;
    case "pick": {
      // No selectMin ⇒ optional: 0 slots — gates nothing, reserves nothing.
      const min = r.selectMin ?? 0;
      // A flat pick collapses into one pool of `min` interchangeable slots.
      // Test `r`, not node.children: compilePick empties a flat pick's children.
      const codes = flatCoursePickOptions(r);
      if (codes) {
        buckets.push({
          need: min,
          // Equivalence-aware: a placed cross-listed twin fills the slot
          // under its REAL code.
          eligible: [...new Set(codes.flatMap(placedMatches))],
          // The options' real weight when uniform (e.g. a 1.0-unit full-year
          // pick), else the matcher's 0.5 default.
          estimateUnit: uniformUnit(codes, unitsOf),
          owner: node,
        });
        break;
      }
      // Compound pick: one course must NOT satisfy a whole group. Credit
      // satisfied children up to `min`, heaviest-first so a tight free pool
      // keeps the higher-unit group named; reserve the rest at the flat estimate.
      const satisfiedChildren = node.children
        .filter(isSatisfied)
        .map((child) => ({
          child,
          units: child.satisfiers.reduce((u, p) => u + unitsOf(p.code), 0),
        }))
        .sort((a, b) => b.units - a.units);
      let credited = 0;
      for (const { child } of satisfiedChildren) {
        if (credited >= min) break;
        collect(
          child,
          placed,
          placedMatches,
          buckets,
          unitPools,
          required,
          unitsOf,
        );
        credited += 1;
      }
      if (credited < min)
        buckets.push({ need: min - credited, eligible: [], owner: node });
      break;
    }
    case "subjectPool": {
      const f = subjectPoolNodeFilter(r);
      const eligible = [...placed].filter((c) => poolMatch(c, f));
      // Unit-stated pool ("2.0 units of X") scores by real units (a 1.0-unit
      // course counts 1.0); count-stated pools stay slot-based.
      if (r.needUnits !== undefined)
        unitPools.push({ needUnits: r.needUnits, eligible, owner: node });
      else buckets.push({ need: r.selectCount, eligible, owner: node });
      break;
    }
    case "all":
      for (const c of node.children)
        collect(
          c,
          placed,
          placedMatches,
          buckets,
          unitPools,
          required,
          unitsOf,
        );
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

/** Append match-assigned codes to an owner node's list (skips ownerless/empty). */
function assignToNode(
  nodeAssigned: NodeAssigned,
  owner: AuditNode | undefined,
  codes: string[],
): void {
  if (!owner || codes.length === 0) return;
  const cur = nodeAssigned.get(owner);
  if (cur) cur.push(...codes);
  else nodeAssigned.set(owner, [...codes]);
}

/**
 * Rule-tree buckets: `collect` every root, then convert the required-course
 * map into rank-0 singleton buckets ahead of the rank-1 picks/pools. Returns
 * the bucket/pool lists the elective step appends to.
 */
function buildRuleBuckets(
  roots: readonly (AuditNode | null)[],
  placed: ReadonlySet<string>,
  placedMatches: (code: string) => string[],
  unitsOf: (code: string) => number,
  equiv: EquivalenceIndex,
): { buckets: Bucket[]; unitPools: UnitPool[] } {
  const ruleBuckets: Bucket[] = [];
  const unitPools: UnitPool[] = [];
  const required = new Map<string, AuditNode>();

  for (const root of roots)
    if (root)
      collect(
        root,
        placed,
        placedMatches,
        ruleBuckets,
        unitPools,
        required,
        unitsOf,
      );

  // Required courses → rank-0 singleton buckets, ONE per equivalence class
  // (mirrors partitionByPlacement): a leaf naming both twins of one course is
  // one slot, else the headline demands two placements where the compiled tree
  // shows the row met by one.
  //
  // Rank 0 wins ties: a course both named and pool-eligible credits the NAMED
  // slot — the calendar states pools as "Complete N additional … courses"
  // (Kuali, e.g. Actuarial Science), "additional" meaning beyond the named list.
  const buckets: Bucket[] = [];
  const requiredClasses = new Map<string, { code: string; owner: AuditNode }>();
  for (const [code, owner] of required) {
    const classKey = equiv.classOf(code)[0];
    if (!requiredClasses.has(classKey))
      requiredClasses.set(classKey, { code, owner });
  }
  for (const { code, owner } of requiredClasses.values()) {
    buckets.push({
      need: 1,
      eligible: placedMatches(code),
      estimateUnit: unitsOf(code),
      owner,
      rank: 0,
    });
  }
  // Rank 1 — picks and count-stated pools claim in tree order after the named
  // core; rank 2 — elective lists and communication take what's left.
  buckets.push(...ruleBuckets.map((b) => ({ ...b, rank: 1 })));
  return { buckets, unitPools };
}

/**
 * Append rank-2 buckets IN PLACE: finite electives (consolidated upstream so
 * overlapping pools count once), unit-based subject pools (scored by UNITS in
 * `creditUnitPools` — a single 1.0-unit course satisfies "1.0 unit of X"), and
 * the communication requirement. The returned maps tie each elective to its
 * bucket/pool so the Electives chip reads the same credit as the headline.
 * Option lists and placement keys are both catalog-lowercase; nothing normalizes.
 */
function buildElectiveAndCommBuckets(
  program: Program | null,
  electiveSections: ElectiveSection[] | undefined,
  placedList: readonly string[],
  placedMatches: (code: string) => string[],
  buckets: Bucket[],
  unitPools: UnitPool[],
): {
  electiveBucketIndex: Map<number, number>;
  electivePool: Map<number, UnitPool>;
  commBucketIndex: number | null;
} {
  const electiveBucketIndex = new Map<number, number>();
  const electivePool = new Map<number, UnitPool>();
  let commBucketIndex: number | null = null;
  if (program) {
    (electiveSections ?? deriveElectiveSections(program)).forEach((e, i) => {
      if (e.kind === "finite") {
        electiveBucketIndex.set(i, buckets.length);
        buckets.push({
          need: e.need,
          eligible: [...new Set(e.options.flatMap(placedMatches))],
          rank: 2,
        });
      } else if (e.kind === "subjectPool") {
        const filter = subjectPoolFilter(e); // build the subjects Set once
        const pool: UnitPool = {
          needUnits: e.needUnits,
          eligible: placedList.filter((c) => poolMatch(c, filter)),
        };
        electivePool.set(i, pool);
        unitPools.push(pool);
      }
    });

    // Communication — a pick-one named course. Skip when the rules already
    // include the option, else its units double-count.
    const comm = deriveCommunicationRequirement(program, placedList);
    if (comm && !comm.alreadyInTree) {
      commBucketIndex = buckets.length;
      buckets.push({
        need: comm.need,
        eligible: [...new Set(comm.options.flatMap(placedMatches))],
        rank: 2,
      });
    }
  }
  return { electiveBucketIndex, electivePool, commBucketIndex };
}

/**
 * Optimal unique assignment of courses to slots (maxBipartiteMatch): each
 * course credits exactly one bucket, so overlapping pools can't double-count.
 * Pool-eligible courses match LAST — a pick must not burn a unit pool's only
 * course when a non-pool alternative fills the same slot.
 */
function runMatch(
  buckets: readonly Bucket[],
  unitPools: readonly UnitPool[],
): MatchResult & { nodeFill: NodeFill; nodeAssigned: NodeAssigned } {
  const poolEligible = new Set(unitPools.flatMap((p) => p.eligible));
  const match = maxBipartiteMatch(buckets, { matchLast: poolEligible });

  // Per-node distinct credit (a node can own several buckets); `nodeAssigned`
  // keeps the codes behind the counts so rows chip exactly what credits them.
  const nodeFill: NodeFill = new WeakMap();
  const nodeAssigned: NodeAssigned = new WeakMap();
  for (let bi = 0; bi < buckets.length; bi++) {
    const owner = buckets[bi].owner;
    if (!owner) continue;
    nodeFill.set(owner, (nodeFill.get(owner) ?? 0) + match.filledByBucket[bi]);
    assignToNode(nodeAssigned, owner, match.codesByBucket[bi]);
  }
  return { ...match, nodeFill, nodeAssigned };
}

/**
 * Credit leftover (unmatched) courses toward each unit pool's REAL target,
 * after the matcher so named requirements keep first claim. Consumed courses
 * join `matched` (never reusable as free electives); shortfall reserves named
 * space, shrinking free room and gating completion. Known residual: a bucket
 * choosing BETWEEN two pool-eligible courses still picks by list order, and
 * >32-contested overlaps degrade to the old greedy.
 */
function creditUnitPools(
  unitPools: readonly UnitPool[],
  matched: Set<string>,
  unitsOf: (code: string) => number,
  nodeFill: NodeFill,
  nodeAssigned: NodeAssigned,
): {
  allPoolsMet: boolean;
  poolShortfall: number;
  poolCredit: Map<UnitPool, number>;
} {
  const poolAssign = assignUnitPools(
    unitPools.map((p) => ({
      needUnits: p.needUnits,
      eligible: p.eligible.filter((c) => !matched.has(c)),
    })),
    unitsOf,
  );
  for (const code of poolAssign.used) matched.add(code);

  let allPoolsMet = true;
  let poolShortfall = 0;
  const poolCredit = new Map<UnitPool, number>();
  unitPools.forEach((pool, i) => {
    const got = poolAssign.got[i];
    const credit = Math.min(got, pool.needUnits);
    poolCredit.set(pool, credit);
    // Rule-tree pools own a node → credited units (capped at need) feed its
    // row; elective pools have no owner.
    if (pool.owner)
      nodeFill.set(pool.owner, (nodeFill.get(pool.owner) ?? 0) + credit);
    assignToNode(nodeAssigned, pool.owner, poolAssign.usedByPool[i]);
    if (!unitsMet(got, pool.needUnits)) {
      poolShortfall += pool.needUnits - got;
      allPoolsMet = false;
    }
  });
  return { allPoolsMet, poolShortfall, poolCredit };
}

/**
 * The unit ledger: named volume (real units of matched courses + per-slot
 * estimates for unfilled slots) against the degree total; the remainder is
 * free-elective room, filled by leftover placed courses.
 */
function computeFreeUnits(
  program: Program | null,
  buckets: readonly Bucket[],
  filledByBucket: readonly number[],
  matched: ReadonlySet<string>,
  placedList: readonly string[],
  unitsOf: (code: string) => number,
  allPoolsMet: boolean,
  poolShortfall: number,
): {
  totalUnits: number | null;
  denom: number;
  freeUnits: number;
  creditedUnits: number;
  allBucketsFilled: boolean;
} {
  // Roll up: real units of matched courses + per-slot estimate for unfilled
  // slots, so a 1.0-unit pick costs the free pool a full unit, not a flat 0.5.
  let namedCreditedUnits = 0;
  for (const code of matched) namedCreditedUnits += unitsOf(code);
  let allBucketsFilled = allPoolsMet;
  let unfilledEstimate = poolShortfall;
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
    if (matched.has(code)) continue;
    if (freeCreditedUnits >= freeUnits) break;
    freeCreditedUnits += unitsOf(code);
  }
  freeCreditedUnits = Math.min(freeCreditedUnits, freeUnits);

  // Real units only — unfilled-slot estimates (in `namedUnits`) shape free room
  // but must never reach credit, or an empty plan would show progress.
  const creditedUnits = Math.min(namedCreditedUnits + freeCreditedUnits, denom);

  return { totalUnits, denom, freeUnits, creditedUnits, allBucketsFilled };
}

/**
 * The completion gates: breadth and level floors (independent filters that
 * block 100% without inflating the denominator), still-owed unverified
 * requirements, and the final pct with its false-100 guard.
 */
function gateCompletion(
  program: Program | null,
  placedList: readonly string[],
  unitsOf: (code: string) => number,
  acknowledged: ReadonlySet<string>,
  unverifiedRequirements: readonly string[] | undefined,
  allBucketsFilled: boolean,
  creditedUnits: number,
  denom: number,
): {
  breadthRequirements: BreadthRequirement[];
  levelFloors: LevelFloor[];
  owedUnverified: string[];
  allComplete: boolean;
  pct: number;
} {
  // Breadth is an independent filter (a course may satisfy breadth AND the
  // major): gates 100% without inflating the denominator. Tracked in units.
  const breadthRequirements = program
    ? deriveBreadthRequirements(program, placedList, unitsOf)
    : [];
  const allBreadthMet = breadthRequirements.every((b) =>
    unitsMet(b.placedUnits, b.needUnits),
  );
  // "Couldn't auto-verify" ≠ "unmet": acknowledged items stop gating. The owed
  // list is the caller's pre-merged one; absent it, the program's own.
  const owedUnverified = (
    unverifiedRequirements ??
    program?.unverifiedRequirements ??
    []
  ).filter((r) => !acknowledged.has(r));

  // Level floors ("X units at the 200-level+") gate like breadth: an
  // overlapping filter, no denominator inflation.
  const levelFloors = program
    ? deriveLevelFloors(program, placedList, unitsOf)
    : [];
  const allFloorsMet = levelFloors.every((f) =>
    unitsMet(f.placedUnits, f.needUnits),
  );

  const allComplete =
    allBucketsFilled &&
    allBreadthMet &&
    allFloorsMet &&
    owedUnverified.length === 0;
  const raw = denom > 0 ? Math.round((creditedUnits / denom) * 100) : 0;
  // Full VOLUME required for 100: `allComplete` can hold with free-elective
  // units unplaced, where Math.round would round ~99.6% up to a false 100.
  const pct =
    allComplete && unitsMet(creditedUnits, denom)
      ? Math.min(raw, 100)
      : Math.min(raw, 99);

  return { breadthRequirements, levelFloors, owedUnverified, allComplete, pct };
}

/**
 * Compute the unified degree-progress headline.
 *
 * @param unitsOf units of a placed course (unknown codes default 0.5 upstream).
 * @param legality slot-scoped illegal-placement keys from `creditExclusionKeys`,
 *   excluded from credit (still shown met-but-flagged on their row).
 * @param equiv MUST match what `compileAudit` got, else a twin marks the tree
 *   row met while its bucket sits unfilled — pct stuck below 100, rows green.
 */
export function computeDegreeProgress(
  audit: AuditRoot,
  program: Program | null,
  unitsOf: (code: string) => number,
  legality: ReadonlySet<string> = new Set(),
  equiv: EquivalenceIndex = EMPTY_EQUIVALENCE,
  /** Manually confirmed `unverifiedRequirements` (verbatim); acknowledged ones
   *  stop gating the 100% headline ("not unmet, just unverified"). */
  acknowledged: ReadonlySet<string> = new Set(),
  /** MUST be the same array `deriveMacros` receives, so `electiveCredit[i]`
   *  lines up with the i-th elective (buildProgramAudit threads one instance
   *  to both); omit to derive locally. */
  electiveSections?: ElectiveSection[],
  /** Owed items to gate on, pre-merged by the caller (program + selected spec,
   *  deduped — buildProgramAudit does this once). Omitted ⇒ the program's own. */
  unverifiedRequirements?: readonly string[],
): DegreeProgress {
  const roots: (AuditNode | null)[] = [
    audit.flexibleRoot,
    audit.specializationRoot,
    ...(audit.byTerm ? Object.values(audit.byTerm) : []),
  ];

  // Drop illegally-placed courses before crediting: one placed before its
  // prereqs (or in antireq conflict) can't honestly count toward the degree.
  const { illegalCodes } = splitPlacementByLegality(audit.placement, legality);

  // Courses an `excluded` rule bars never credit the headline (named or free);
  // they still surface as excludedViolations on their row.
  const excludedCodes = new Set<string>();
  for (const root of roots) if (root) collectExcluded(root, excludedCodes);

  const placedList = [...audit.placement.keys()].filter(
    (c) => !illegalCodes.has(c) && !excludedCodes.has(c),
  );
  const placed = new Set(placedList);

  // Real placed codes satisfying a requirement code: the exact code, else its
  // placed cross-listed equivalents (never the unplaced requirement code).
  const placedMatches = (code: string): string[] => {
    if (placed.has(code)) return [code];
    return equiv.classOf(code).filter((m) => m !== code && placed.has(m));
  };

  const { buckets, unitPools } = buildRuleBuckets(
    roots,
    placed,
    placedMatches,
    unitsOf,
    equiv,
  );

  const { electiveBucketIndex, electivePool, commBucketIndex } =
    buildElectiveAndCommBuckets(
      program,
      electiveSections,
      placedList,
      placedMatches,
      buckets,
      unitPools,
    );

  const { filledByBucket, matched, nodeFill, nodeAssigned } = runMatch(
    buckets,
    unitPools,
  );

  const { allPoolsMet, poolShortfall, poolCredit } = creditUnitPools(
    unitPools,
    matched,
    unitsOf,
    nodeFill,
    nodeAssigned,
  );

  // Per-elective credit for the panel chip: a finite elective's filled count, a
  // pool's credited units — both post-match, so a claimed course isn't re-counted.
  const electiveCredit: number[] = [];
  for (const [i, bi] of electiveBucketIndex)
    electiveCredit[i] = filledByBucket[bi];
  for (const [i, pool] of electivePool)
    electiveCredit[i] = poolCredit.get(pool) ?? 0;

  const { totalUnits, denom, freeUnits, creditedUnits, allBucketsFilled } =
    computeFreeUnits(
      program,
      buckets,
      filledByBucket,
      matched,
      placedList,
      unitsOf,
      allPoolsMet,
      poolShortfall,
    );

  const { breadthRequirements, levelFloors, owedUnverified, allComplete, pct } =
    gateCompletion(
      program,
      placedList,
      unitsOf,
      acknowledged,
      unverifiedRequirements,
      allBucketsFilled,
      creditedUnits,
      denom,
    );

  return {
    totalUnits,
    denom,
    creditedUnits,
    pct,
    allComplete,
    freeUnits,
    breadthRequirements,
    levelFloors,
    owedUnverified,
    nodeFill,
    electiveCredit,
    nodeAssigned,
    ...(commBucketIndex !== null && {
      commCredit: filledByBucket[commBucketIndex],
    }),
  };
}
