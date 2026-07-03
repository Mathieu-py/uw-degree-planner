import { type PoolFilter, poolMatch } from "@/lib/courses/code";
import {
  EMPTY_EQUIVALENCE,
  type EquivalenceIndex,
} from "@/lib/courses/equivalence";
import { unitsMet } from "@/lib/format";
import { type Program, type RuleNode, walkRule } from "@/lib/programs";
import { type BreadthRequirement, deriveBreadthRequirements } from "./breadth";
import { deriveCommunicationRequirement } from "./communication";
import {
  type AuditNode,
  type AuditRoot,
  isSatisfied,
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
  /**
   * Structured reqs done: every bucket filled + breadth/floors met + nothing
   * unverified. Can be true while free-elective units are still unplaced — use
   * `pct === 100` for "degree fully done", not this flag.
   */
  allComplete: boolean;
  /** Free-elective room in the degree (units, ≥ 0). */
  freeUnits: number;
  /** Faculty breadth requirements ("1.0 unit of Humanities"), scored in units. */
  breadthRequirements: BreadthRequirement[];
  /** Faculty level-floor requirements ("X units at the 200-level+"), scored. */
  levelFloors: LevelFloor[];
  /**
   * `unverifiedRequirements` not yet acknowledged on the plan. Non-empty ⇒
   * headline held below 100%. Surfaced near the headline so "check with your
   * advisor" is actionable.
   */
  owedUnverified: string[];
  /**
   * Per-rule-node distinct credit from the global bipartite match: how many of
   * each owning {@link AuditNode}'s slots a UNIQUE course actually filled. Read
   * by the audit panel (keyed by node identity) so a requirement ROW reflects the
   * same one-course-per-slot assignment as this headline — an overlapping pool
   * (e.g. "1 additional ENGL course") shows unmet once its courses are claimed by
   * named requirements, not re-counted. (`needed` comes from `summarize`.)
   */
  nodeFill: NodeFill;
  /**
   * Per-elective credit (index-aligned to `deriveElectiveSections`): a finite
   * elective's filled count or a pool's credited units, so the Electives chip
   * reads the same match credit as the headline. Sparse — no entry for "browse".
   */
  electiveCredit: number[];
}

/** Filled-slot count per owning rule-tree node (see {@link DegreeProgress.nodeFill}). */
export type NodeFill = WeakMap<AuditNode, number>;

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
  /**
   * The rule-tree node these slots belong to, when one exists (rule-tree
   * buckets only — elective/communication buckets have no node). After the
   * match, each owner's filled-slot total feeds `nodeFill`, so the panel's
   * requirement rows read the SAME one-course-per-slot credit as the headline
   * instead of an independent per-node count that double-credits overlapping
   * pools (#21 follow-up).
   */
  owner?: AuditNode;
}

/**
 * A units-scored requirement (a unit-stated `subjectPool`, or an elective unit
 * pool): a 1.0-unit course counts as 1.0, unlike a count {@link Bucket}. `owner`
 * is set for rule-tree pools so their row matches the headline.
 */
interface UnitPool {
  needUnits: number;
  eligible: string[];
  owner?: AuditNode;
}

/** Every course code appearing in `courses` leaves under a node (pick pools). */
function leafCodes(node: RuleNode, out: string[]): void {
  walkRule(node, (n) => {
    if (n.kind === "courses") out.push(...n.courses);
  });
}

/**
 * The shared unit weight of a set of option codes, or undefined when they
 * differ (or the set is empty). Lets an unfilled pick reserve its options'
 * real weight — a 1.0-unit full-year pick must reserve 1.0, not a flat 0.5, or
 * free-elective room is overstated. Mixed-weight options stay ambiguous → the
 * caller falls back to the 0.5 default.
 */
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

/** A subjectPool rule as a normalized (lowercased) {@link PoolFilter}. */
function poolFilterOf(
  node: Extract<RuleNode, { kind: "subjectPool" }>,
): PoolFilter {
  return {
    subjects: new Set(node.subjectCodes.map((s) => s.toLowerCase())),
    minLevel: node.minLevel,
    maxLevel: node.maxLevel,
  };
}

/**
 * Walk a rule tree, collecting volume buckets and required-course codes.
 * `courses` under `all` are all-required (one singleton each); a `subjectPool`
 * filters by prefix/level; `excluded` is ignored. Picks mirror {@link compilePick}:
 * an all-`courses` pick collapses into one pool, a compound pick credits only its
 * genuinely-satisfied option-groups (see the `pick` case).
 *
 * `placedMatches` maps a requirement code to the real PLACED codes satisfying
 * it (exact, else cross-listed equivalents), so every pass counts a course once.
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
      // First leaf to name a code owns its singleton bucket (codes rarely repeat
      // across leaves; first-wins keeps the owner stable).
      for (const c of r.courses) if (!required.has(c)) required.set(c, node);
      break;
    case "pick": {
      // No selectMin ⇒ an optional pick: 0 required slots, so it neither gates
      // completion nor reserves units; its placed courses fall to free electives.
      const min = r.selectMin ?? 0;
      // Mirror compilePick. When every option is a bare `courses` leaf, collapse
      // them into one pool of `min` interchangeable slots ("1 of: A, B, C").
      // Test r.children: compilePick collapses an all-`courses` pick to an empty
      // AuditNode.children, so node.children can't distinguish the two cases.
      const allCoursesLeaves =
        r.children.length > 0 && r.children.every((c) => c.kind === "courses");
      if (allCoursesLeaves) {
        const codes: string[] = [];
        leafCodes(r, codes);
        buckets.push({
          need: min,
          // Equivalence-aware (mirrors partitionByPlacement): an option's
          // placed cross-listed twin fills the slot under its REAL code.
          eligible: [...new Set(codes.flatMap(placedMatches))],
          // Reserve the options' real weight when uniform (e.g. a full-year
          // 1.0-unit pick), else the 0.5 default via the matcher.
          estimateUnit: uniformUnit(codes, unitsOf),
          owner: node,
        });
        break;
      }
      // Compound pick ("1 of: {A and B} or {C and D}"): a single course must NOT
      // satisfy a whole group. Credit genuinely-satisfied children up to `min`,
      // heaviest-first so a tight free pool keeps the higher-unit group named;
      // reserve the rest at the flat per-slot estimate.
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
      const f = poolFilterOf(r);
      const eligible = [...placed].filter((c) => poolMatch(c, f));
      // Unit-stated pool ("2.0 units of X"): score by real units (a 1.0-unit
      // course counts as 1.0, never doubling the count). Count-stated pools stay
      // slot-based.
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

/**
 * Compute the unified degree-progress headline.
 *
 * @param unitsOf units of a placed course (caller defaults unknown codes to 0.5).
 * @param legality slot-scoped keys of illegally-placed courses, from
 *   `creditExclusionKeys`. Excluded from credit so they never inflate the headline
 *   (still shown met-but-flagged on their row).
 * @param equiv course-equivalence index (#21). MUST match what `compileAudit`
 *   was given, else a twin marks the tree row met while this leaves its bucket
 *   unfilled — pct stuck below 100 with every row green.
 */
export function computeDegreeProgress(
  audit: AuditRoot,
  program: Program | null,
  unitsOf: (code: string) => number,
  legality: ReadonlySet<string> = new Set(),
  equiv: EquivalenceIndex = EMPTY_EQUIVALENCE,
  /**
   * Verbatim `unverifiedRequirements` the student manually confirmed; an
   * acknowledged one stops gating the 100% headline ("not unmet, just unverified").
   */
  acknowledged: ReadonlySet<string> = new Set(),
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

  // Real placed codes satisfying a requirement code: the exact code, else its
  // placed cross-listed equivalents (never the unplaced requirement code).
  const placedMatches = (code: string): string[] => {
    if (placed.has(code)) return [code];
    return equiv.classOf(code).filter((m) => m !== code && placed.has(m));
  };

  const buckets: Bucket[] = [];
  const unitPools: UnitPool[] = [];
  const required = new Map<string, AuditNode>();

  for (const root of roots)
    if (root)
      collect(
        root,
        placed,
        placedMatches,
        buckets,
        unitPools,
        required,
        unitsOf,
      );

  // Finite electives (consolidated upstream so overlapping pools count once)
  // and unit-based subject pools ("0.5 unit of BIOL/CHEM/… at 200+").
  // Option lists and placement keys are both catalog-lowercase, so the exact
  // `placed.has`/`filter` matches below are case-safe; nothing normalizes here.
  //
  // Subject pools are scored by UNITS, not a 0.5-derived course count: a single
  // 1.0-unit course satisfies "1.0 unit of X", and a 0.25 lab counts for what it
  // weighs. They're assigned in a units pass after the count-based matcher
  // (below), like breadth/level floors. (Issue #101.) `unitPools` already holds
  // any unit-stated `subjectPool` from the tree. Map each elective to the
  // bucket/pool it becomes (keyed by identity, robust to the sort below) so the
  // chip reads the same match credit as the headline, not a double-count.
  const electiveBucketIndex = new Map<number, number>();
  const electivePool = new Map<number, UnitPool>();
  if (program) {
    deriveElectiveSections(program).forEach((e, i) => {
      if (e.kind === "finite") {
        electiveBucketIndex.set(i, buckets.length);
        buckets.push({
          need: e.need,
          eligible: [...new Set(e.options.flatMap(placedMatches))],
        });
      } else if (e.kind === "subjectPool") {
        const pool: UnitPool = {
          needUnits: e.needUnits,
          eligible: placedList.filter((c) => subjectPoolEligible(c, e)),
        };
        electivePool.set(i, pool);
        unitPools.push(pool);
      }
    });

    // Communication — a pick-one named course. Skip when the rules already
    // include the option, else its units double-count.
    const comm = deriveCommunicationRequirement(program, placedList);
    if (comm && !comm.alreadyInTree)
      buckets.push({
        need: comm.need,
        eligible: [...new Set(comm.options.flatMap(placedMatches))],
      });
  }

  // Required courses → singleton buckets; each reserves its real catalog units.
  // Collapse to one bucket per equivalence class first (mirrors compileAudit's
  // partitionByPlacement, #21, keyed on the sorted class head): a leaf naming
  // both twins of one course — or two leaves each naming a twin — is ONE
  // required course, not two slots, else the headline demands two placements
  // where the compiled tree shows the row met by a single one.
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
    });
  }

  // Optimal unique assignment of courses to slots (maxBipartiteMatch): each
  // matched course credits exactly one bucket, so overlapping pools can't
  // double-count and a satisfiable set is never left spuriously unfilled.
  const { filledByBucket, matched } = maxBipartiteMatch(buckets);

  // Per-node distinct credit: roll each owning rule-node's filled-slot total up,
  // so the panel's requirement rows reflect this match (one course → one slot)
  // rather than an independent count that lets a course satisfy several
  // overlapping requirements. A node owning several buckets (a multi-course leaf,
  // or a compound pick + its residual) sums across them.
  const nodeFill: NodeFill = new WeakMap();
  for (let bi = 0; bi < buckets.length; bi++) {
    const owner = buckets[bi].owner;
    if (!owner) continue;
    nodeFill.set(owner, (nodeFill.get(owner) ?? 0) + filledByBucket[bi]);
  }

  // Unit pools (a unit-stated `subjectPool` rule, or a unit-based elective pool,
  // issue #101): assign leftover (not-yet-matched) eligible courses until their
  // REAL units cover needUnits. Assigned courses join `matched` so they credit
  // their real units once and a free elective can't reuse them; any shortfall
  // reserves named space (like an unfilled count slot) so it shrinks free room
  // and gates completion. Pools run after the matcher, so named rule requirements
  // keep first claim on a course.
  //
  // Most-constrained-first (fewest still-available courses) so overlapping pools
  // don't strand each other: "0.5 unit of CS" claims the shared course before
  // "0.5 unit of CS or MATH" (which falls back to MATH); list order left it at 99%.
  let allPoolsMet = true;
  let poolShortfall = 0;
  const availCount = (p: UnitPool) =>
    p.eligible.filter((c) => !matched.has(c)).length;
  const orderedPools = [...unitPools].sort(
    (a, b) => availCount(a) - availCount(b),
  );
  const poolCredit = new Map<UnitPool, number>();
  for (const pool of orderedPools) {
    let got = 0;
    for (const code of pool.eligible) {
      if (got >= pool.needUnits) break;
      if (matched.has(code)) continue;
      matched.add(code);
      got += unitsOf(code);
    }
    poolCredit.set(pool, Math.min(got, pool.needUnits));
    // Rule-tree pools own a node → record credited units (capped at need) so the
    // row matches the headline; elective pools have no owner.
    if (pool.owner)
      nodeFill.set(
        pool.owner,
        (nodeFill.get(pool.owner) ?? 0) + Math.min(got, pool.needUnits),
      );
    if (got < pool.needUnits) {
      poolShortfall += pool.needUnits - got;
      allPoolsMet = false;
    }
  }

  // Per-elective credit for the panel chip: a finite elective's filled count, a
  // pool's credited units — both post-match, so a claimed course isn't re-counted.
  const electiveCredit: number[] = [];
  for (const [i, bi] of electiveBucketIndex)
    electiveCredit[i] = filledByBucket[bi];
  for (const [i, pool] of electivePool)
    electiveCredit[i] = poolCredit.get(pool) ?? 0;

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

  // Breadth is an independent filter (a course may satisfy breadth AND the
  // major), so it gates 100% without inflating the denominator. Tracked in
  // units, as the calendar states it.
  const breadthRequirements = program
    ? deriveBreadthRequirements(program, placedList, unitsOf)
    : [];
  const allBreadthMet = breadthRequirements.every((b) =>
    unitsMet(b.placedUnits, b.needUnits),
  );
  // "Couldn't auto-verify" ≠ "unmet": an acknowledged requirement no longer gates
  // the headline. Only still-owed (unacknowledged) ones do.
  const owedUnverified = (program?.unverifiedRequirements ?? []).filter(
    (r) => !acknowledged.has(r),
  );

  // Level floors ("X units at the 200-level+") gate completion like breadth:
  // an overlapping filter that blocks 100% without inflating the denominator.
  const levelFloors = program
    ? deriveLevelFloors(program, placedList, unitsOf)
    : [];
  const allFloorsMet = levelFloors.every((f) =>
    unitsMet(f.placedUnits, f.need),
  );

  const allComplete =
    allBucketsFilled &&
    allBreadthMet &&
    allFloorsMet &&
    owedUnverified.length === 0;
  const raw = denom > 0 ? Math.round((creditedUnits / denom) * 100) : 0;
  // Require full VOLUME for 100, not just the structured gates: `allComplete` can
  // hold with free-elective units unplaced (creditedUnits < denom), where
  // `Math.round` would otherwise round ~99.6% up to a false 100.
  const pct =
    allComplete && unitsMet(creditedUnits, denom)
      ? Math.min(raw, 100)
      : Math.min(raw, 99);

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
  };
}
