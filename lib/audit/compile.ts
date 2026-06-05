/**
 * Audit compiler: walks a `RuleNode` paired with a `LocalPlan`'s placed
 * courses and emits an `AuditNode` tree whose shape mirrors the rule tree,
 * decorated with status, satisfiers, and miss-counts for the UI.
 *
 * Semantics:
 *  - `all`: every child must be met (or overSatisfied). Mixed → partial.
 *  - `pick` whose direct children are all `courses` leaves: union the codes
 *    into one option pool; count distinct placed codes. Met when count
 *    ≥ selectMin; overSatisfied when count > selectMax.
 *  - `pick` with mixed/nested children: count children whose status is met
 *    or overSatisfied; same threshold logic against selectMin/selectMax.
 *  - `subjectPool`: count placed courses whose prefix and level match the
 *    pool's filters. Threshold is `selectCount` exactly.
 *  - `courses` leaf at the top of a tree (no pick parent): treat as all-required.
 *  - `excluded`: never gates status; the UI surfaces violations as warnings.
 */

import { courseLevel, coursePrefix, levelBucket } from "@/lib/courses/code";
import type { LocalPlan } from "@/lib/plan/types";
import {
  describeRule,
  getSpecialization,
  type Program,
  type RuleNode,
  type Specialization,
  TERM_LETTERS,
  type TermLetter,
} from "@/lib/programs";
import type { Placement, PlacementMap } from "./placement";
import { buildPlacementMap } from "./placement";

export type AuditStatus = "met" | "partial" | "unmet" | "overSatisfied";

export interface AuditNode {
  ruleNode: RuleNode;
  status: AuditStatus;
  description?: string;
  /** Placed courses that contribute to satisfying this node. */
  satisfiers: Placement[];
  /** Codes still needed (only meaningful for courses leaves and pick aggregates). */
  missingCodes: string[];
  /** For pick + subjectPool: how many slots/options are filled. */
  satisfiedCount?: number;
  selectMin?: number;
  selectMax?: number;
  /** Excluded-courses violations: codes the student has placed that the rule says cannot count. */
  excludedViolations?: Placement[];
  /**
   * Satisfiers that ARE placed but NOT legally (an unmet prereq or an antireq
   * conflict in their slot). They still count toward the requirement
   * ("met-but-flagged"), but the UI surfaces a warning so the student knows the
   * progress rests on an invalid placement. Coreqs are advisory and excluded.
   */
  illegalSatisfiers?: Placement[];
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
function placementLegalityKey(p: Placement): string {
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

function compile(
  node: RuleNode,
  placement: PlacementMap,
  legality: ReadonlySet<string>,
): AuditNode {
  switch (node.kind) {
    case "courses": {
      // Top-level / under all: treat as all-required.
      const satisfiers: Placement[] = [];
      const missing: string[] = [];
      for (const code of node.courses) {
        const p = placement.get(code);
        if (p) satisfiers.push(p);
        else missing.push(code);
      }
      const status: AuditStatus =
        satisfiers.length === node.courses.length
          ? "met"
          : satisfiers.length > 0
            ? "partial"
            : "unmet";
      return withIllegal(
        {
          ruleNode: node,
          status,
          satisfiers,
          missingCodes: missing,
          children: [],
        },
        illegalAmong(satisfiers, legality),
      );
    }
    case "all": {
      const children = node.children.map((c) =>
        compile(c, placement, legality),
      );
      return withIllegal(
        {
          ruleNode: node,
          status: statusFromAllChildren(children),
          description: describeRule(node),
          satisfiers: children.flatMap((c) => c.satisfiers),
          missingCodes: children.flatMap((c) => c.missingCodes),
          children,
        },
        children.flatMap((c) => c.illegalSatisfiers ?? []),
      );
    }
    case "pick":
      return compilePick(node, placement, legality);
    case "subjectPool":
      return compileSubjectPool(node, placement, legality);
    case "excluded": {
      const violations: Placement[] = [];
      for (const code of node.courses) {
        const p = placement.get(code);
        if (p) violations.push(p);
      }
      return {
        ruleNode: node,
        // Excluded rules never block status — informational only.
        status: "met",
        description: describeRule(node),
        satisfiers: [],
        missingCodes: [],
        excludedViolations: violations,
        children: [],
      };
    }
  }
}

/**
 * A `pick` node. When every child is a `courses` leaf, the options collapse
 * into one distinct-code pool (so MATH235 named in two branches counts once).
 * Otherwise each child must be independently met to count toward the threshold.
 */
function compilePick(
  node: Extract<RuleNode, { kind: "pick" }>,
  placement: PlacementMap,
  legality: ReadonlySet<string>,
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
    const satisfiers: Placement[] = [];
    const missing: string[] = [];
    for (const code of options) {
      const p = placement.get(code);
      if (p) satisfiers.push(p);
      else missing.push(code);
    }
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
        selectMin: node.selectMin,
        selectMax: node.selectMax,
        children: [],
      },
      illegalAmong(satisfiers, legality),
    );
  }
  // Mixed/nested children: each must be independently met to count as 1.
  const children = node.children.map((c) => compile(c, placement, legality));
  // A child only counts toward the parent's threshold when placements actually
  // satisfy it. An *optional* child (e.g. "Choose any of the following", with
  // selectMin 0/undefined) is vacuously "met" with nothing placed; counting it
  // would inflate the parent's progress on an empty plan (issue #95). Requiring
  // ≥1 satisfier excludes those vacuous mets without affecting genuine ones.
  const count = children.filter(
    (c) =>
      (c.status === "met" || c.status === "overSatisfied") &&
      c.satisfiers.length > 0,
  ).length;
  const anyPartial = children.some((c) => c.status === "partial");
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
      // No definite missing set: a compound pick needs only `selectMin` of its
      // children, so there's no single list of codes that "would complete it".
      // The panel surfaces the per-child state by recursing into `children`.
      missingCodes: [],
      satisfiedCount: count,
      selectMin: node.selectMin,
      selectMax: node.selectMax,
      children,
    },
    children.flatMap((c) => c.illegalSatisfiers ?? []),
  );
}

/**
 * A `subjectPool` node: count placed courses whose prefix is in the pool and
 * whose level falls within the optional min/max bounds. The threshold is
 * `selectCount` exactly (used as both selectMin and selectMax).
 */
function compileSubjectPool(
  node: Extract<RuleNode, { kind: "subjectPool" }>,
  placement: PlacementMap,
  legality: ReadonlySet<string>,
): AuditNode {
  const subjects = new Set(node.subjectCodes.map((s) => s.toLowerCase()));
  const satisfiers: Placement[] = [];
  for (const [code, p] of placement) {
    if (!subjects.has(coursePrefix(code))) continue;
    const lvl = levelBucket(courseLevel(code));
    if (node.minLevel !== undefined && lvl < node.minLevel) continue;
    if (node.maxLevel !== undefined && lvl > node.maxLevel) continue;
    satisfiers.push(p);
  }
  return withIllegal(
    {
      ruleNode: node,
      status: statusFromPickCount(
        satisfiers.length,
        node.selectCount,
        node.selectCount,
        false,
      ),
      description: describeRule(node),
      satisfiers,
      missingCodes: [],
      satisfiedCount: satisfiers.length,
      selectMin: node.selectCount,
      selectMax: node.selectCount,
      children: [],
    },
    illegalAmong(satisfiers, legality),
  );
}

/**
 * Build the slot-scoped key set of placements that are placed but NOT legally
 * — an unmet prereq or an antireq conflict. Coreqs are advisory (never block),
 * so they're excluded. Keyed `slotId::code` so the same course in two slots is
 * judged per-placement. {@link compileAudit} consumes this to flag satisfiers.
 */
export function legalityKeySet(
  issues: readonly { slotId: string; courseCode: string; kind: string }[],
): Set<string> {
  const out = new Set<string>();
  for (const i of issues) {
    if (i.courseCode === "") continue; // slot-level (overload) — not a placement
    if (i.kind === "prereq" || i.kind === "antireq")
      out.add(`${i.slotId}::${i.courseCode}`);
  }
  return out;
}

export function compileAudit(
  program: Program | null,
  plan: LocalPlan,
  specializationId: string | null = null,
  /**
   * Slot-scoped keys (`slotId::code`) of illegally-placed courses, from
   * {@link legalityKeySet}. Satisfiers matching a key are flagged on their node
   * (met-but-flagged). Empty/omitted → no legality overlay.
   */
  legality: ReadonlySet<string> = new Set(),
): AuditRoot {
  const placement = buildPlacementMap(plan);
  const programId = plan.programId;
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
        compile(program.terms[t], placement, legality),
      ]),
    ) as Record<TermLetter, AuditNode>;
  } else {
    flexibleRoot = compile(program.rules, placement, legality);
  }
  let specializationRoot: AuditNode | null = null;
  if (specializationId) {
    const localSpec = program.specializations?.find(
      (s) => s.slug === specializationId,
    );
    const spec: Specialization | null =
      localSpec ??
      (programId ? getSpecialization(programId, specializationId) : null);
    if (spec?.rules) {
      specializationRoot = compile(spec.rules, placement, legality);
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
 * Roll-up summary across an audit subtree. Counts each leaf-equivalent
 * "requirement slot" once: a `courses` leaf under all = N requirements, a
 * `pick` = selectMin requirements, a `subjectPool` = selectCount, and an
 * `all` propagates the sum of its children. Used for headline numbers.
 *
 * `excludedViolationCount` is the total number of placed courses that hit
 * an `excluded` rule anywhere in this subtree. Excluded rules deliberately
 * do NOT change `status` (see "Semantics" comment at the top of this file);
 * the count is surfaced so the panel can render a small warning badge
 * without re-walking the tree.
 */
export function summarize(node: AuditNode): {
  needed: number;
  satisfied: number;
  excludedViolationCount: number;
} {
  const r = node.ruleNode;
  switch (r.kind) {
    case "courses":
      return {
        needed: r.courses.length,
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
      // Pick children are subordinate: an excluded leaf can sit underneath
      // a pick when the program wraps "either A or B" choices around a
      // shared excluded note. Fold counts up the same way as `all`.
      let excludedViolationCount = 0;
      for (const c of node.children) {
        excludedViolationCount += summarize(c).excludedViolationCount;
      }
      return { needed: min, satisfied: got, excludedViolationCount };
    }
    case "subjectPool": {
      const got = Math.min(node.satisfiedCount ?? 0, r.selectCount);
      return {
        needed: r.selectCount,
        satisfied: got,
        excludedViolationCount: 0,
      };
    }
    case "excluded":
      return {
        needed: 0,
        satisfied: 0,
        excludedViolationCount: node.excludedViolations?.length ?? 0,
      };
  }
}
