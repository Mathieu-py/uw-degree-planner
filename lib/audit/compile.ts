/**
 * Audit compiler: walks a `RuleNode` against a plan's placed courses, emitting
 * a same-shape `AuditNode` tree with status, satisfiers, and miss-counts.
 *
 * Semantics:
 *  - `all`: every child met/overSatisfied; mixed → partial.
 *  - `pick` over all-`courses` children: union codes into one pool, count
 *    distinct placed; met at ≥ selectMin, overSatisfied at > selectMax.
 *  - `pick` over mixed/nested children: count met children, same threshold.
 *  - `subjectPool`: count placed courses matching prefix + level; threshold is
 *    `selectCount` exactly.
 *  - `courses` leaf with no pick parent: all-required.
 *  - `excluded`: never gates status; violations surface as UI warnings.
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
   * Satisfiers placed illegally (unmet prereq / antireq conflict in their
   * slot). Still count ("met-but-flagged"), but the UI warns. Coreqs are
   * advisory, so excluded.
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

/** Split codes into the placements that satisfy them and the codes still missing. */
function partitionByPlacement(
  codes: Iterable<string>,
  placement: PlacementMap,
): { satisfiers: Placement[]; missing: string[] } {
  const satisfiers: Placement[] = [];
  const missing: string[] = [];
  for (const code of codes) {
    const p = placement.get(code);
    if (p) satisfiers.push(p);
    else missing.push(code);
  }
  return { satisfiers, missing };
}

function compile(
  node: RuleNode,
  placement: PlacementMap,
  legality: ReadonlySet<string>,
): AuditNode {
  switch (node.kind) {
    case "courses": {
      // Top-level / under all: treat as all-required.
      const { satisfiers, missing } = partitionByPlacement(
        node.courses,
        placement,
      );
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
      const { satisfiers: violations } = partitionByPlacement(
        node.courses,
        placement,
      );
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
 * A `pick` node. All-`courses` children collapse into one distinct-code pool
 * (MATH235 in two branches counts once); otherwise each child must be
 * independently met to count toward the threshold.
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
    const { satisfiers, missing } = partitionByPlacement(options, placement);
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
  // Require ≥1 satisfier: an optional child (selectMin 0/undefined) is
  // vacuously "met" with nothing placed, which would inflate the parent on an
  // empty plan (issue #95).
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
      // No definite missing set: a compound pick needs only `selectMin`
      // children, so no single code list completes it. Panel recurses instead.
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
 * level is within the optional bounds. Threshold is `selectCount` exactly.
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
 * Slot-scoped keys (`slotId::code`) of illegally-placed courses (unmet prereq /
 * antireq; coreqs are advisory). Per-slot so the same course in two slots is
 * judged independently. {@link compileAudit} flags satisfiers against it.
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
   * Slot-scoped keys from {@link legalityKeySet}. Matching satisfiers are
   * flagged (met-but-flagged). Empty/omitted → no legality overlay.
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
 * Whether a node is GENUINELY satisfied — "met"/"overSatisfied" with ≥1
 * satisfier — vs. a vacuously-met optional group. Lets choice UIs tell whether
 * a pick has actually been decided.
 */
export function isSatisfied(node: AuditNode): boolean {
  return (
    (node.status === "met" || node.status === "overSatisfied") &&
    node.satisfiers.length > 0
  );
}

/**
 * Roll-up across a subtree for headline numbers, counting each slot once:
 * `courses` = N, `pick` = selectMin, `subjectPool` = selectCount, `all` sums
 * its children.
 *
 * `excludedViolationCount` totals placed courses hitting an `excluded` rule.
 * Those rules don't change `status`; the count is surfaced so the panel can
 * badge it without re-walking the tree.
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
      // An excluded leaf can sit under a pick (program wraps "either A or B"
      // around a shared excluded note). Fold counts up the same way as `all`.
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
