/**
 * Audit compiler: walks a `RuleNode` against placed courses → same-shape
 * `AuditNode` tree (status, satisfiers, miss-counts). Per kind:
 *  - `all`: all children met → met; mixed → partial.
 *  - `pick` over all-`courses`: union into one distinct-code pool, met at
 *    ≥ selectMin, overSatisfied at > selectMax.
 *  - `pick` over mixed/nested: count met children, same threshold.
 *  - `subjectPool`: count prefix+level matches; threshold = selectCount exactly.
 *  - `courses` leaf with no pick parent: all-required.
 *  - `excluded`: never gates status; violations surface as UI warnings.
 */

import { poolMatch } from "@/lib/courses/code";
import {
  EMPTY_EQUIVALENCE,
  type EquivalenceIndex,
} from "@/lib/courses/equivalence";
import { unitsMet } from "@/lib/format";
import type { LocalPlan } from "@/lib/plan/types";
import {
  describeRule,
  type Program,
  type RuleNode,
  type Specialization,
  TERM_LETTERS,
  type TermLetter,
} from "@/lib/programs";
import type { Placement, PlacementMap } from "./placement";
import { buildPlacementMap } from "./placement";

type AuditStatus = "met" | "partial" | "unmet" | "overSatisfied";

export interface AuditNode {
  ruleNode: RuleNode;
  status: AuditStatus;
  description?: string;
  /** Placed courses that contribute to satisfying this node. */
  satisfiers: Placement[];
  /** Codes still needed (meaningful for courses leaves and pick aggregates). */
  missingCodes: string[];
  /** For pick + subjectPool: how many slots/options are filled. */
  satisfiedCount?: number;
  selectMin?: number;
  selectMax?: number;
  /** Placed codes that hit an `excluded` rule (the rule says they can't count). */
  excludedViolations?: Placement[];
  /**
   * Satisfiers placed illegally (unmet prereq / antireq conflict). Still count
   * ("met-but-flagged"); UI warns. Coreqs are advisory, so excluded.
   */
  illegalSatisfiers?: Placement[];
  /**
   * Met on legal placements ALONE (illegal satisfiers dropped). Cards recede to
   * "done" on this, not `isSatisfied` (which counts flagged placements), so they
   * agree with the degree bar. See {@link isLegallyMet}.
   */
  legallyMet?: boolean;
  children: AuditNode[];
}

export interface AuditRoot {
  programId: string | null;
  specializationId: string | null;
  /** Engineering: one AuditNode per term (1A–4B). */
  byTerm: Record<TermLetter, AuditNode> | null;
  /** Flexible programs: the single root tree. */
  flexibleRoot: AuditNode | null;
  /** Optional spec rules (own tree). */
  specializationRoot: AuditNode | null;
  /** Course-to-slot lookup used during compilation; reused by UI for navigation. */
  placement: PlacementMap;
}

function statusFromAllChildren(children: AuditNode[]): AuditStatus {
  if (children.length === 0) return "met";
  const allMet = children.every(
    (c) => c.status === "met" || c.status === "overSatisfied",
  );
  if (allMet) return "met";
  const noneStarted = children.every((c) => c.status === "unmet");
  return noneStarted ? "unmet" : "partial";
}

function statusFromPickCount(
  count: number,
  selectMin: number | undefined,
  selectMax: number | undefined,
  anyPartial: boolean,
): AuditStatus {
  const min = selectMin ?? 0;
  if (count >= min) {
    if (selectMax !== undefined && count > selectMax) return "overSatisfied";
    return "met";
  }
  return count > 0 || anyPartial ? "partial" : "unmet";
}

/** Stable key for a placement, matching a slot-scoped legality issue. */
export function placementLegalityKey(p: Placement): string {
  return `${p.slotId}::${p.code}`;
}

/** The subset of `satisfiers` whose placement has a blocking legality issue. */
function illegalAmong(
  satisfiers: readonly Placement[],
  legality: ReadonlySet<string>,
): Placement[] {
  if (legality.size === 0) return [];
  return satisfiers.filter((p) => legality.has(placementLegalityKey(p)));
}

/** Attach `illegalSatisfiers` to a node only when there are any (keeps nodes lean). */
function withIllegal(node: AuditNode, illegal: Placement[]): AuditNode {
  return illegal.length > 0 ? { ...node, illegalSatisfiers: illegal } : node;
}

/**
 * Split codes into satisfying placements and still-missing codes. A code is
 * satisfied by its exact placement OR any cross-listed equivalent (#21); the
 * equivalent's placement is credited directly, never duplicated.
 *
 * Codes collapse to one per equivalence class first, since an option list can
 * name several codes of ONE course (a pool listing both PSYCH 352 and 352R) —
 * else one placement counts once per listed twin, inflating "choose N" pools.
 * `optionCount` is the post-collapse total; status math compares against it.
 */
function partitionByPlacement(
  codes: Iterable<string>,
  placement: PlacementMap,
  equiv: EquivalenceIndex,
): { satisfiers: Placement[]; missing: string[]; optionCount: number } {
  const satisfiers: Placement[] = [];
  const missing: string[] = [];
  const seenClasses = new Set<string>();
  let optionCount = 0;
  for (const code of codes) {
    // classOf is sorted, so [0] is a stable class key.
    const classKey = equiv.classOf(code)[0];
    if (seenClasses.has(classKey)) continue;
    seenClasses.add(classKey);
    optionCount++;
    let p = placement.get(code);
    if (!p) {
      for (const member of equiv.classOf(code)) {
        const mp = placement.get(member);
        if (mp) {
          p = mp;
          break;
        }
      }
    }
    if (p) satisfiers.push(p);
    else missing.push(code);
  }
  return { satisfiers, missing, optionCount };
}

function compile(
  node: RuleNode,
  placement: PlacementMap,
  legality: ReadonlySet<string>,
  equiv: EquivalenceIndex,
  unitsOf: (code: string) => number,
): AuditNode {
  switch (node.kind) {
    case "courses": {
      // Top-level / under all: all-required. Met when every DISTINCT course
      // (one per class) is placed — a leaf naming both twins needs one course.
      const { satisfiers, missing, optionCount } = partitionByPlacement(
        node.courses,
        placement,
        equiv,
      );
      const status: AuditStatus =
        satisfiers.length === optionCount
          ? "met"
          : satisfiers.length > 0
            ? "partial"
            : "unmet";
      const illegal = illegalAmong(satisfiers, legality);
      return withIllegal(
        {
          ruleNode: node,
          status,
          satisfiers,
          missingCodes: missing,
          // Every named course is required, so any illegal one is load-bearing.
          legallyMet: satisfiers.length - illegal.length >= optionCount,
          children: [],
        },
        illegal,
      );
    }
    case "all": {
      const children = node.children.map((c) =>
        compile(c, placement, legality, equiv, unitsOf),
      );
      return withIllegal(
        {
          ruleNode: node,
          status: statusFromAllChildren(children),
          description: describeRule(node),
          satisfiers: children.flatMap((c) => c.satisfiers),
          missingCodes: children.flatMap((c) => c.missingCodes),
          // Every child must be legally met (excluded children are transparent).
          legallyMet: children.every((c) => c.legallyMet === true),
          children,
        },
        children.flatMap((c) => c.illegalSatisfiers ?? []),
      );
    }
    case "pick":
      return compilePick(node, placement, legality, equiv, unitsOf);
    case "subjectPool":
      return compileSubjectPool(node, placement, legality, unitsOf);
    case "excluded": {
      const { satisfiers: violations } = partitionByPlacement(
        node.courses,
        placement,
        equiv,
      );
      return {
        ruleNode: node,
        // Excluded rules never block status — informational only.
        status: "met",
        description: describeRule(node),
        satisfiers: [],
        missingCodes: [],
        excludedViolations: violations,
        legallyMet: true,
        children: [],
      };
    }
  }
}

/**
 * A `pick` node. All-`courses` children collapse into one distinct-code pool
 * (MATH235 in two branches counts once); otherwise each child must be
 * independently met to count.
 */
function compilePick(
  node: Extract<RuleNode, { kind: "pick" }>,
  placement: PlacementMap,
  legality: ReadonlySet<string>,
  equiv: EquivalenceIndex,
  unitsOf: (code: string) => number,
): AuditNode {
  const allCoursesLeaves =
    node.children.length > 0 &&
    node.children.every((c) => c.kind === "courses");
  if (allCoursesLeaves) {
    const options = [
      ...new Set(
        node.children.flatMap((c) => (c.kind === "courses" ? c.courses : [])),
      ),
    ];
    const { satisfiers, missing } = partitionByPlacement(
      options,
      placement,
      equiv,
    );
    // No `satisfiers > 0` guard (unlike the nested branch): a flat pool has no
    // vacuously-met children, and a min-0 pool is correctly "met" at 0 —
    // consumers needing "actually decided" call `isSatisfied`.
    const illegal = illegalAmong(satisfiers, legality);
    const legalCount = satisfiers.length - illegal.length;
    return withIllegal(
      {
        ruleNode: node,
        status: statusFromPickCount(
          satisfiers.length,
          node.selectMin,
          node.selectMax,
          false,
        ),
        description: describeRule(node),
        satisfiers,
        missingCodes: missing,
        satisfiedCount: satisfiers.length,
        // Decided by legal picks alone (≥1, and ≥ selectMin).
        legallyMet: legalCount > 0 && legalCount >= (node.selectMin ?? 0),
        selectMin: node.selectMin,
        selectMax: node.selectMax,
        children: [],
      },
      illegal,
    );
  }
  // Mixed/nested children: each must be independently met to count as 1.
  const children = node.children.map((c) =>
    compile(c, placement, legality, equiv, unitsOf),
  );
  // Require ≥1 satisfier: an optional child is vacuously "met" with nothing
  // placed, inflating the parent on an empty plan (issue #95).
  const count = children.filter(
    (c) =>
      (c.status === "met" || c.status === "overSatisfied") &&
      c.satisfiers.length > 0,
  ).length;
  const anyPartial = children.some((c) => c.status === "partial");
  // Only options met on legal placements count toward "decided".
  const legalCount = children.filter(
    (c) => c.legallyMet === true && c.satisfiers.length > 0,
  ).length;
  return withIllegal(
    {
      ruleNode: node,
      status: statusFromPickCount(
        count,
        node.selectMin,
        node.selectMax,
        anyPartial,
      ),
      description: describeRule(node),
      satisfiers: children.flatMap((c) => c.satisfiers),
      // No definite missing set: a compound pick needs only `selectMin`
      // children, so no single code list completes it. Panel recurses.
      missingCodes: [],
      satisfiedCount: count,
      legallyMet: legalCount > 0 && legalCount >= (node.selectMin ?? 0),
      selectMin: node.selectMin,
      selectMax: node.selectMax,
      children,
    },
    children.flatMap((c) => c.illegalSatisfiers ?? []),
  );
}

/**
 * A `subjectPool` node: count placed courses with a pooled prefix and in-bounds
 * level. Threshold is `selectCount` exactly.
 *
 * DELIBERATELY literal-match only (no equivalence widening, unlike courses/pick):
 * whether AMATH 242 counts toward "N CS courses" is a calendar question the UW
 * calendar doesn't answer generally, and the transcript records the enrolled
 * code — so we count what was taken. If a program is confirmed to accept
 * cross-listings, thread `equiv` through with a citation (AGENTS.md).
 */
function compileSubjectPool(
  node: Extract<RuleNode, { kind: "subjectPool" }>,
  placement: PlacementMap,
  legality: ReadonlySet<string>,
  unitsOf: (code: string) => number,
): AuditNode {
  const filter = {
    subjects: new Set(node.subjectCodes.map((s) => s.toLowerCase())),
    minLevel: node.minLevel,
    maxLevel: node.maxLevel,
  };
  const satisfiers: Placement[] = [];
  for (const [code, p] of placement) {
    if (poolMatch(code, filter)) satisfiers.push(p);
  }
  // Unit-stated pool ("2.0 units of X"): gate on real units (a 1.0-unit course
  // counts as 1.0), so `satisfiedCount` holds placed units. Count-stated pools
  // gate on `selectCount` exactly. Units are additive credit weights — UW
  // Undergraduate Calendar Glossary ("Credit"): "A credit weight of 0.5 is
  // normally assigned to a one-term course … some have weights such as … 1.0, 2.0."
  const unitBased = node.needUnits !== undefined;
  const need = node.needUnits ?? node.selectCount;
  const have = unitBased
    ? satisfiers.reduce((u, p) => u + unitsOf(p.code), 0)
    : satisfiers.length;
  const status: AuditStatus = unitBased
    ? unitsMet(have, need)
      ? "met"
      : have > 0
        ? "partial"
        : "unmet"
    : statusFromPickCount(have, need, need, false);
  // Drop illegal placements to decide "legally met": by real units when
  // unit-stated (a load-bearing illegal 1.0-unit course removes 1.0), else by
  // count. Overflow illegal placements beyond `need` leave it legally met.
  const illegal = illegalAmong(satisfiers, legality);
  const legalHave = unitBased
    ? have - illegal.reduce((u, p) => u + unitsOf(p.code), 0)
    : satisfiers.length - illegal.length;
  return withIllegal(
    {
      ruleNode: node,
      status,
      description: describeRule(node),
      satisfiers,
      missingCodes: [],
      satisfiedCount: have,
      legallyMet: unitBased ? unitsMet(legalHave, need) : legalHave >= need,
      selectMin: need,
      selectMax: need,
      children: [],
    },
    illegal,
  );
}

/** The fields the credit-exclusion helpers read off a plan validation issue. */
export interface PlacementIssue {
  slotId: string;
  courseCode: string;
  kind: string;
  /** Antireq only: the placed codes this course conflicts with (lowercased). */
  conflictsWith?: readonly string[];
}

interface ConflictMember {
  code: string;
  slotId: string;
}

/**
 * Group antireq issues into conflict sets — connected components over the
 * symmetric `conflictsWith` edges. Each set lists its placements; used to credit
 * one member per conflict and to count a conflict once.
 */
export function antireqConflictGroups(
  issues: readonly PlacementIssue[],
): ConflictMember[][] {
  // First occurrence wins, mirroring buildPlacementMap (keeps first slot per
  // code; issues arrive in slot order). Must agree, else an exclusion key
  // `slotId::code` could name a slot the placement map never recorded and the
  // legality overlay would silently miss that satisfier.
  const slotOf = new Map<string, string>();
  for (const i of issues) {
    if (
      i.kind === "antireq" &&
      i.courseCode !== "" &&
      !slotOf.has(i.courseCode)
    )
      slotOf.set(i.courseCode, i.slotId);
  }
  const adj = new Map<string, Set<string>>();
  const ensure = (c: string) => {
    let s = adj.get(c);
    if (!s) {
      s = new Set();
      adj.set(c, s);
    }
    return s;
  };
  for (const i of issues) {
    if (i.kind !== "antireq" || !slotOf.has(i.courseCode)) continue;
    for (const other of i.conflictsWith ?? []) {
      if (!slotOf.has(other) || other === i.courseCode) continue;
      ensure(i.courseCode).add(other);
      ensure(other).add(i.courseCode);
    }
  }
  const seen = new Set<string>();
  const groups: ConflictMember[][] = [];
  for (const start of slotOf.keys()) {
    if (seen.has(start)) continue;
    const comp: string[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length > 0) {
      const cur = stack.pop() as string;
      comp.push(cur);
      for (const nb of adj.get(cur) ?? []) {
        if (!seen.has(nb)) {
          seen.add(nb);
          stack.push(nb);
        }
      }
    }
    groups.push(
      comp.map((code) => ({ code, slotId: slotOf.get(code) as string })),
    );
  }
  return groups;
}

/** Pick the member to KEEP: program-referenced > higher units > code ascending. */
function pickKeeper(
  group: ConflictMember[],
  referenced: ReadonlySet<string>,
  unitsOf: (code: string) => number,
): ConflictMember {
  return [...group].sort((a, b) => {
    const ra = referenced.has(a.code) ? 1 : 0;
    const rb = referenced.has(b.code) ? 1 : 0;
    if (ra !== rb) return rb - ra;
    const ua = unitsOf(a.code);
    const ub = unitsOf(b.code);
    if (ua !== ub) return ub - ua;
    return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
  })[0];
}

/**
 * Slot-scoped keys (`slotId::code`) to EXCLUDE from degree credit. Per-program
 * (keeper depends on what the program requires):
 *  - every prereq-misplaced course;
 *  - every antireq conflict member except the keeper — UW grants credit for one
 *    of an antireq pair, never both, never zero.
 * Passed unchanged to {@link compileAudit} / {@link computeDegreeProgress}.
 */
export function creditExclusionKeys(
  issues: readonly PlacementIssue[],
  opts: { referenced: ReadonlySet<string>; unitsOf: (code: string) => number },
): Set<string> {
  const out = new Set<string>();
  for (const i of issues) {
    if (i.courseCode === "") continue; // slot-level (overload) — not a placement
    if (i.kind === "prereq") out.add(`${i.slotId}::${i.courseCode}`);
  }
  for (const group of antireqConflictGroups(issues)) {
    if (group.length <= 1) continue;
    const keeper = pickKeeper(group, opts.referenced, opts.unitsOf);
    for (const m of group) {
      if (m.code === keeper.code && m.slotId === keeper.slotId) continue;
      out.add(`${m.slotId}::${m.code}`);
    }
  }
  return out;
}

/**
 * Plan-wide count of blocking issues for the header: one per prereq-misplaced
 * course plus one per antireq conflict SET (not per course). Program-agnostic —
 * group cardinality doesn't depend on the keeper.
 */
export function countPlacementIssues(
  issues: readonly PlacementIssue[],
): number {
  let prereqs = 0;
  for (const i of issues) {
    if (i.courseCode !== "" && i.kind === "prereq") prereqs++;
  }
  return prereqs + antireqConflictGroups(issues).length;
}

export function compileAudit(
  program: Program | null,
  plan: LocalPlan,
  specializationId: string | null = null,
  /**
   * Slot-scoped keys from {@link creditExclusionKeys}; matches are flagged
   * met-but-flagged. Empty/omitted → no legality overlay.
   */
  legality: ReadonlySet<string> = new Set(),
  /**
   * Id of `program`, stamped onto the result. Passed explicitly since a plan can
   * carry several programs (double degree).
   */
  programId: string | null = null,
  /**
   * Course-equivalence index (GitHub #21): a required code is also satisfied by
   * a placed cross-listed equivalent. Omitted → exact-code matching only.
   */
  equiv: EquivalenceIndex = EMPTY_EQUIVALENCE,
  /**
   * Units of a placed course (default 0.5). Used only to score unit-stated
   * `subjectPool` rules ("2.0 units of X") by real units instead of a 0.5 count.
   */
  unitsOf: (code: string) => number = () => 0.5,
): AuditRoot {
  const placement = buildPlacementMap(plan);
  if (!program) {
    return {
      programId,
      specializationId,
      byTerm: null,
      flexibleRoot: null,
      specializationRoot: null,
      placement,
    };
  }
  let byTerm: Record<TermLetter, AuditNode> | null = null;
  let flexibleRoot: AuditNode | null = null;
  if (program.kind === "engineering") {
    byTerm = Object.fromEntries(
      TERM_LETTERS.map((t) => [
        t,
        compile(program.terms[t], placement, legality, equiv, unitsOf),
      ]),
    ) as Record<TermLetter, AuditNode>;
  } else {
    flexibleRoot = compile(program.rules, placement, legality, equiv, unitsOf);
  }
  let specializationRoot: AuditNode | null = null;
  if (specializationId) {
    const spec: Specialization | null =
      program.specializations?.find((s) => s.slug === specializationId) ?? null;
    if (spec?.rules) {
      specializationRoot = compile(
        spec.rules,
        placement,
        legality,
        equiv,
        unitsOf,
      );
    }
  }
  return {
    programId,
    specializationId,
    byTerm,
    flexibleRoot,
    specializationRoot,
    placement,
  };
}

/**
 * GENUINELY satisfied — met/overSatisfied with ≥1 satisfier — vs. a
 * vacuously-met optional group. Lets choice UIs tell if a pick was decided.
 */
export function isSatisfied(node: AuditNode): boolean {
  return (
    (node.status === "met" || node.status === "overSatisfied") &&
    node.satisfiers.length > 0
  );
}

/**
 * Like {@link isSatisfied}, but satisfied by legally-credited placements ALONE —
 * a requirement met only because of an illegal placement (before its prereqs /
 * in an antireq conflict) is NOT legally met. The UI recedes a card to "done"
 * on this, not `isSatisfied`, so the card agrees with the degree bar (which
 * doesn't credit illegal placements). Nodes built without the `legallyMet` field
 * (test mocks) fall back to `isSatisfied`.
 */
export function isLegallyMet(node: AuditNode): boolean {
  return node.legallyMet ?? isSatisfied(node);
}

/**
 * Roll-up for headline numbers, counting each slot once: `courses` = N,
 * `pick` = selectMin, `subjectPool` = selectCount, `all` sums children.
 * `excludedViolationCount` totals `excluded`-rule hits (don't change status;
 * surfaced so the panel can badge without re-walking).
 */
export function summarize(node: AuditNode): {
  needed: number;
  satisfied: number;
  excludedViolationCount: number;
} {
  const r = node.ruleNode;
  switch (r.kind) {
    case "courses":
      // `satisfiers + missingCodes` is the post-equivalence option count (see
      // partitionByPlacement) — a leaf naming both twins of one course is ONE
      // slot, matching the headline. `r.courses.length` would double-count it.
      return {
        needed: node.satisfiers.length + node.missingCodes.length,
        satisfied: node.satisfiers.length,
        excludedViolationCount: 0,
      };
    case "all": {
      let needed = 0;
      let satisfied = 0;
      let excludedViolationCount = 0;
      for (const c of node.children) {
        const s = summarize(c);
        needed += s.needed;
        satisfied += s.satisfied;
        excludedViolationCount += s.excludedViolationCount;
      }
      return { needed, satisfied, excludedViolationCount };
    }
    case "pick": {
      const min = r.selectMin ?? 0;
      const got = Math.min(node.satisfiedCount ?? 0, min);
      // An excluded leaf can sit under a pick; fold counts up as in `all`.
      let excludedViolationCount = 0;
      for (const c of node.children) {
        excludedViolationCount += summarize(c).excludedViolationCount;
      }
      return { needed: min, satisfied: got, excludedViolationCount };
    }
    case "subjectPool": {
      // Unit-stated pools report in units (satisfiedCount holds placed units);
      // count-stated pools in courses.
      const need = r.needUnits ?? r.selectCount;
      const got = Math.min(node.satisfiedCount ?? 0, need);
      return { needed: need, satisfied: got, excludedViolationCount: 0 };
    }
    case "excluded":
      return {
        needed: 0,
        satisfied: 0,
        excludedViolationCount: node.excludedViolations?.length ?? 0,
      };
  }
}
