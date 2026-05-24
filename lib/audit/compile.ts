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

import type { LocalPlan } from "../plan/types";
import type {
  Program,
  RuleNode,
  Specialization,
  TermLetter,
} from "../programs";
import { describeRule, getSpecialization, TERM_LETTERS } from "../programs";
import type { TermId } from "../types";
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

function levelBucket(code: string): number {
  const m = code.match(/(\d+)/);
  if (!m) return 0;
  return Math.floor(parseInt(m[0], 10) / 100) * 100;
}

function coursePrefix(code: string): string {
  return (code.match(/^([a-z]+)/i)?.[1] ?? "").toLowerCase();
}

function compile(node: RuleNode, placement: PlacementMap): AuditNode {
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
      return {
        ruleNode: node,
        status,
        satisfiers,
        missingCodes: missing,
        children: [],
      };
    }
    case "all": {
      const children = node.children.map((c) => compile(c, placement));
      return {
        ruleNode: node,
        status: statusFromAllChildren(children),
        description: describeRule(node),
        satisfiers: children.flatMap((c) => c.satisfiers),
        missingCodes: children.flatMap((c) => c.missingCodes),
        children,
      };
    }
    case "pick": {
      const allCoursesLeaves =
        node.children.length > 0 &&
        node.children.every((c) => c.kind === "courses");
      if (allCoursesLeaves) {
        const options = [
          ...new Set(
            node.children.flatMap((c) =>
              c.kind === "courses" ? c.courses : [],
            ),
          ),
        ];
        const satisfiers: Placement[] = [];
        const missing: string[] = [];
        for (const code of options) {
          const p = placement.get(code);
          if (p) satisfiers.push(p);
          else missing.push(code);
        }
        return {
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
        };
      }
      // Mixed/nested children: each must be independently met to count as 1.
      const children = node.children.map((c) => compile(c, placement));
      const count = children.filter(
        (c) => c.status === "met" || c.status === "overSatisfied",
      ).length;
      const anyPartial = children.some((c) => c.status === "partial");
      return {
        ruleNode: node,
        status: statusFromPickCount(
          count,
          node.selectMin,
          node.selectMax,
          anyPartial,
        ),
        description: describeRule(node),
        satisfiers: children.flatMap((c) => c.satisfiers),
        missingCodes: [],
        satisfiedCount: count,
        selectMin: node.selectMin,
        selectMax: node.selectMax,
        children,
      };
    }
    case "subjectPool": {
      const subjects = new Set(node.subjectCodes.map((s) => s.toLowerCase()));
      const satisfiers: Placement[] = [];
      for (const [code, p] of placement) {
        if (!subjects.has(coursePrefix(code))) continue;
        const lvl = levelBucket(code);
        if (node.minLevel !== undefined && lvl < node.minLevel) continue;
        if (node.maxLevel !== undefined && lvl > node.maxLevel) continue;
        satisfiers.push(p);
      }
      return {
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
      };
    }
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

export function compileAudit(
  program: Program | null,
  plan: LocalPlan,
  specializationId: string | null = null,
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
      TERM_LETTERS.map((t) => [t, compile(program.terms[t], placement)]),
    ) as Record<TermLetter, AuditNode>;
  } else {
    flexibleRoot = compile(program.rules, placement);
  }
  let specializationRoot: AuditNode | null = null;
  if (programId && specializationId) {
    const spec: Specialization | null = getSpecialization(
      programId,
      specializationId,
    );
    if (spec?.rules) {
      specializationRoot = compile(spec.rules, placement);
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
 */
export function summarize(node: AuditNode): {
  needed: number;
  satisfied: number;
} {
  const r = node.ruleNode;
  switch (r.kind) {
    case "courses":
      return {
        needed: r.courses.length,
        satisfied: node.satisfiers.length,
      };
    case "all": {
      let needed = 0;
      let satisfied = 0;
      for (const c of node.children) {
        const s = summarize(c);
        needed += s.needed;
        satisfied += s.satisfied;
      }
      return { needed, satisfied };
    }
    case "pick": {
      const min = r.selectMin ?? 0;
      const got = Math.min(node.satisfiedCount ?? 0, min);
      return { needed: min, satisfied: got };
    }
    case "subjectPool": {
      const got = Math.min(node.satisfiedCount ?? 0, r.selectCount);
      return { needed: r.selectCount, satisfied: got };
    }
    case "excluded":
      return { needed: 0, satisfied: 0 };
  }
}

export type { TermId };
