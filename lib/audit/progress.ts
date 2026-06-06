import { courseLevel, coursePrefix, levelBucket } from "@/lib/courses/code";
import type { Program, RuleNode } from "@/lib/programs";
import { type BreadthRequirement, deriveBreadthRequirements } from "./breadth";
import { deriveCommunicationRequirement } from "./communication";
import {
  type AuditNode,
  type AuditRoot,
  placementLegalityKey,
} from "./compile";
import { deriveElectiveSections, subjectPoolEligible } from "./electives";
import { deriveLevelFloors, type LevelFloor } from "./levelFloors";

/**
 * The degree audit headline as a SINGLE progress bar in UNITS:
 * `creditedUnits / totalUnits`. The denominator is the degree's authoritative
 * size (`unitPlan.totalUnits`, exact — every course carries its real unit
 * weight); the numerator credits each placed course (its units) to at most one
 * requirement, plus the free-elective remainder, capped at the total.
 *
 * Why units, not a course count: courses aren't uniformly 0.5 unit (0.25-unit
 * labs/PD, 1.0-unit full-year), so a course count never reconciles cleanly with
 * the unit-defined degree size. Units do — named + free = total exactly.
 *
 * Why this avoids the old unit engine's contradictions: the denominator is one
 * fixed number, never a sum of (overlapping, double-counted) requirement slots.
 * We only ASSIGN placed courses into it and cap the total — so messy/redundant
 * scraped requirements (e.g. a "Technical Electives List" that re-unions its own
 * sub-lists) can't push the bar past 100% or make it incoherent.
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
   * Units to reserve for each UNFILLED slot (filled slots reserve their real
   * units). A specific required course knows its exact units; a pool/pick/
   * elective slot can't know which option you'll pick, so it estimates ~0.5.
   */
  estimateUnit?: number;
}

/** Every course code appearing in `courses` leaves under a node (pick pools). */
function leafCodes(node: RuleNode, out: string[]): void {
  switch (node.kind) {
    case "courses":
      out.push(...node.courses);
      break;
    case "all":
    case "pick":
      for (const c of node.children) leafCodes(c, out);
      break;
    // subjectPool / excluded contribute no concrete option codes here.
  }
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
 * `courses` leaves reached via `all` are all-required (one singleton each);
 * a `pick` unions its descendant course leaves into one option pool; a
 * `subjectPool` filters placed codes by prefix/level. `excluded` is ignored.
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
      const codes: string[] = [];
      leafCodes(r, codes);
      buckets.push({
        need: r.selectMin ?? 0,
        eligible: codes.filter((c) => placed.has(c)),
      });
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

/**
 * Compute the unified degree-progress headline.
 *
 * @param unitsOf units of a placed course (caller supplies, defaulting unknown
 *   codes to 0.5 so each unmapped course counts as one slot).
 * @param legality slot-scoped keys (`slotId::code`) of illegally-placed courses
 *   (unmet prereq / antireq conflict), from `legalityKeySet`. Such placements
 *   are EXCLUDED from credit — they still show as met-but-flagged on their
 *   requirement row, but invalid placements never inflate the headline number.
 */
export function computeDegreeProgress(
  audit: AuditRoot,
  program: Program | null,
  unitsOf: (code: string) => number,
  legality: ReadonlySet<string> = new Set(),
): DegreeProgress {
  // Drop illegally-placed courses before any crediting: a course placed before
  // its prereqs (or in antireq conflict) can't honestly count toward the degree.
  const illegalCodes = new Set<string>();
  if (legality.size > 0)
    for (const [code, p] of audit.placement)
      if (legality.has(placementLegalityKey(p))) illegalCodes.add(code);

  const placedList = [...audit.placement.keys()].filter(
    (c) => !illegalCodes.has(c),
  );
  const placed = new Set(placedList);

  const buckets: Bucket[] = [];
  const required = new Set<string>();

  const roots: (AuditNode | null)[] = [
    audit.flexibleRoot,
    audit.specializationRoot,
    ...(audit.byTerm ? Object.values(audit.byTerm) : []),
  ];
  for (const root of roots) if (root) collect(root, placed, buckets, required);

  // Finite electives (consolidated upstream so overlapping pools count once) and
  // unit-based subject pools ("0.5 unit of BIOL/CHEM/… at 200+").
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

    // Communication requirement — a pick-one named course. Skip when the rules
    // already include the option (it's counted there; adding it would
    // double-count its units).
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

  // Greedy unique assignment, most-constrained buckets first. Each placed course
  // credits exactly one bucket (its real units) → overlapping pools can't
  // double-count, and a course's full unit weight lands wherever it's credited.
  // `namedUnits` reserves real units for FILLED slots and the per-slot estimate
  // for unfilled ones — so a 1.0-unit pick costs the free-elective pool a full
  // unit, not a flat 0.5 (no over-stated "free units").
  const ordered = [...buckets].sort(
    (a, b) => a.eligible.length - b.eligible.length,
  );
  const used = new Set<string>();
  let namedCreditedUnits = 0;
  let namedUnits = 0;
  let allBucketsFilled = true;
  for (const bk of ordered) {
    let filled = 0;
    let filledUnits = 0;
    for (const code of bk.eligible) {
      if (filled >= bk.need) break;
      if (used.has(code)) continue;
      used.add(code);
      filled++;
      filledUnits += unitsOf(code);
    }
    namedCreditedUnits += filledUnits;
    namedUnits += filledUnits + (bk.need - filled) * (bk.estimateUnit ?? 0.5);
    if (filled < bk.need) allBucketsFilled = false;
  }

  // The degree's total units IS the denominator (exact, authoritative) — no
  // course-count rounding. Free-elective units are simply the remainder, so
  // named + free = total by construction. Fall back to named units if unknown.
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
  // major), so it never inflates the denominator — but it does gate 100%.
  // Tracked in UNITS, exactly as the calendar states it ("1.0 unit of …").
  const breadthRequirements = program
    ? deriveBreadthRequirements(program, placedList, unitsOf)
    : [];
  const allBreadthMet = breadthRequirements.every(
    (b) => b.placedUnits >= b.needUnits - 1e-9,
  );
  const unverifiedOwed = (program?.unverifiedRequirements?.length ?? 0) > 0;

  // Level floors ("X units at the 200-level or above") gate completion the same
  // way breadth does — an overlapping filter, so they never inflate the
  // denominator, but the headline can't read 100% while one is unmet.
  const levelFloors = program
    ? deriveLevelFloors(program, placedList, unitsOf)
    : [];
  const allFloorsMet = levelFloors.every((f) => f.placedUnits >= f.need - 1e-9);

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
