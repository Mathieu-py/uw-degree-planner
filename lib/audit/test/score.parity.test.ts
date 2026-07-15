import { describe, expect, it } from "vitest";
import { namedGroupLabel } from "../../../components/planner/audit/deriveMacros";
import { equivalenceForCatalog } from "../../courses/equivalence";
import { unitsMet } from "../../format";
import { type Program, TERM_LETTERS } from "../../programs";
import { PROGRAMS } from "../../programs/registry";
import {
  type AuditNode,
  compileAudit,
  isLegallyMet,
  summarize,
} from "../compile";
import { foldFiniteElectivesIntoRules } from "../foldElectives";
import {
  computeDegreeProgress,
  type DegreeProgress,
  type NodeAssigned,
  type NodeFill,
} from "../progress";
import {
  isCompoundPick,
  type ScoredNode,
  scoreAudit,
  scoreNode,
} from "../score";
import { lcg } from "./fuzzRand";
import { allCodes, makePlan, mixedUnitsOf, requiredOnly } from "./helpers";

const unitsOf = () => 0.5;

// ---- Frozen pre-refactor reference math ------------------------------------
// Verbatim copies of the deleted components/planner/audit/nodeProgress.ts
// helpers: the ORACLE this suite pins score.ts against. Do not "simplify" them
// toward score.ts — their independence is the point.

function sumOwnedFill(node: AuditNode, fill: NodeFill): number {
  let total = fill.get(node) ?? 0;
  for (const c of node.children) total += sumOwnedFill(c, fill);
  return total;
}

function nodeProgress(
  node: AuditNode,
  fill?: NodeFill,
): { needed: number; satisfied: number } {
  const s = summarize(node);
  if (fill) {
    return {
      needed: s.needed,
      satisfied: Math.min(sumOwnedFill(node, fill), s.needed),
    };
  }
  const illegal = node.illegalSatisfiers?.length ?? 0;
  return { needed: s.needed, satisfied: Math.max(0, s.satisfied - illegal) };
}

function subtreeAssigned(node: AuditNode, assigned: NodeAssigned): string[] {
  const out = assigned.get(node) ?? [];
  return node.children.reduce(
    (acc, c) => acc.concat(subtreeAssigned(c, assigned)),
    [...out],
  );
}
// ---------------------------------------------------------------------------

/**
 * Independent copy of the LOCAL credit semantics (summarizeStep's
 * `legalSatisfied`). Deliberately diverges from nodeProgress's local branch,
 * which subtracted an illegal COURSE COUNT from the capped total — wrong
 * dimension for unit pools, wrong basis for picks.
 */
function localLegalCredit(node: AuditNode): number {
  const r = node.ruleNode;
  switch (r.kind) {
    case "courses":
      return Math.max(
        0,
        node.satisfiers.length - (node.illegalSatisfiers?.length ?? 0),
      );
    case "all": {
      let total = 0;
      for (const c of node.children) total += localLegalCredit(c);
      return total;
    }
    case "pick": {
      const min = r.selectMin ?? 0;
      const legal =
        node.children.length === 0
          ? node.satisfiers.length - (node.illegalSatisfiers?.length ?? 0)
          : node.children.filter(
              (c) => isLegallyMet(c) && c.satisfiers.length > 0,
            ).length;
      return Math.max(0, Math.min(legal, min));
    }
    case "subjectPool": {
      const need = r.needUnits ?? r.selectCount;
      const legal =
        node.legalSatisfiedCount ??
        (node.satisfiedCount ?? 0) - (node.illegalSatisfiers?.length ?? 0);
      return Math.max(0, Math.min(legal, need));
    }
    case "excluded":
      return 0;
  }
}

/**
 * Assert one scored subtree is extensionally identical to what the pre-scored
 * UI derived from the SAME compiled node + fill maps: counts via
 * `nodeProgress`, codes via `subtreeAssigned`, and each card's recede formula.
 */
function verify(
  scored: ScoredNode,
  node: AuditNode,
  progress: DegreeProgress,
  insideCompound: boolean,
): void {
  expect(scored.node).toBe(node);
  expect(scored.children).toHaveLength(node.children.length);

  const compound = isCompoundPick(node);
  const expectedSource = insideCompound || compound ? "local" : "match";
  expect(scored.source).toBe(expectedSource);

  const fillS = nodeProgress(node, progress.nodeFill);
  expect(scored.needed).toBe(fillS.needed); // needed is fill-independent

  if (scored.source === "match") {
    expect(scored.credit).toBe(fillS.satisfied);
    expect(scored.creditedCodes).toEqual(
      subtreeAssigned(node, progress.nodeAssigned),
    );
  } else {
    expect(scored.credit).toBe(localLegalCredit(node));
    expect(scored.creditedCodes).toEqual([]);
  }

  // Recede parity — each branch is the formula the corresponding card used
  // before score.ts existed (NodeBody/ChooseOneRow/SubjectPoolBody/CompoundPick).
  const r = node.ruleNode;
  let expectedComplete: boolean;
  if (r.kind === "courses") expectedComplete = isLegallyMet(node);
  else if (r.kind === "pick") {
    if (compound)
      expectedComplete =
        node.children.filter(isLegallyMet).length >= (r.selectMin ?? 1);
    else if (scored.source === "match")
      expectedComplete = isLegallyMet(node) && fillS.satisfied >= fillS.needed;
    else expectedComplete = isLegallyMet(node);
  } else if (r.kind === "subjectPool")
    expectedComplete =
      scored.source === "match"
        ? unitsMet(fillS.satisfied, fillS.needed)
        : isLegallyMet(node);
  else if (r.kind === "all") expectedComplete = isLegallyMet(node);
  else expectedComplete = true;
  expect(scored.complete).toBe(expectedComplete);

  scored.children.forEach((c, i) => {
    verify(c, node.children[i], progress, insideCompound || compound);
  });
}

/** Compile + score one (program, codes, spec, legality) case and verify all roots. */
function check(
  program: Program,
  codes: string[],
  opts: {
    programId?: string;
    specId?: string | null;
    legality?: ReadonlySet<string>;
    unitsOf?: (code: string) => number;
  } = {},
): { audit: ReturnType<typeof compileAudit>; progress: DegreeProgress } {
  const legality = opts.legality ?? new Set();
  const weigh = opts.unitsOf ?? unitsOf;
  const audit = compileAudit(
    program,
    makePlan(codes),
    opts.specId ?? null,
    legality,
    opts.programId ?? null,
    undefined,
    weigh,
  );
  const progress = computeDegreeProgress(audit, program, weigh, legality);
  const scored = scoreAudit(audit, progress);
  if (audit.flexibleRoot)
    verify(scored.flexible as ScoredNode, audit.flexibleRoot, progress, false);
  if (audit.specializationRoot)
    verify(
      scored.specialization as ScoredNode,
      audit.specializationRoot,
      progress,
      false,
    );
  if (audit.byTerm)
    for (const t of TERM_LETTERS) {
      const n = audit.byTerm[t];
      if (n)
        verify(
          (scored.byTerm as Record<string, ScoredNode>)[t],
          n,
          progress,
          false,
        );
    }
  return { audit, progress };
}

describe("scoreAudit — parity with the pre-scored UI math, every real program", () => {
  const entries = Object.entries(PROGRAMS);

  it("matches nodeProgress/subtreeAssigned/card-complete on empty, required-only, maximal, and fuzz plans", {
    timeout: 60_000,
  }, () => {
    for (const [id, program] of entries) {
      const folded = foldFiniteElectivesIntoRules(program);
      const maximal = allCodes(folded);
      const rand = lcg(0xc0ffee ^ id.length);
      const fuzz = (p: number) => maximal.filter(() => rand() < p);
      const plans = [[], requiredOnly(folded), maximal, fuzz(0.35), fuzz(0.7)];
      for (const codes of plans) check(folded, codes, { programId: id });
      for (const codes of [maximal, fuzz(0.5)])
        check(folded, codes, { programId: id, unitsOf: mixedUnitsOf });
    }
  });

  it("scores the first specialization's root when selected", () => {
    for (const [id, program] of entries) {
      const spec = program.specializations?.find((s) => s.rules);
      if (!spec) continue;
      const folded = foldFiniteElectivesIntoRules(program);
      check(folded, allCodes(folded), { programId: id, specId: spec.slug });
    }
  });

  it("progress omitted ⇒ whole tree local, matching the no-fill paths", () => {
    for (const [, program] of entries) {
      const folded = foldFiniteElectivesIntoRules(program);
      const audit = compileAudit(
        folded,
        makePlan(allCodes(folded)),
        null,
        new Set(),
        null,
        undefined,
        unitsOf,
      );
      const scored = scoreAudit(audit);
      const walk = (s: ScoredNode) => {
        expect(s.source).toBe("local");
        expect(s.credit).toBe(localLegalCredit(s.node));
        expect(s.creditedCodes).toEqual([]);
        s.children.forEach(walk);
      };
      if (scored.flexible) walk(scored.flexible);
      if (scored.byTerm)
        for (const t of TERM_LETTERS)
          if (scored.byTerm[t]) walk(scored.byTerm[t]);
    }
  });

  it("no real-data divergence at compound picks that are macro BLOCK ROOTS", () => {
    // A compound pick's ScoredNode.credit is its LOCAL count (what its card
    // always showed); the old deriveMacros aggregate used the fill-based count
    // at block roots. Interior compound picks are invisible to that aggregate
    // (raw fill flows through their `all` ancestors unchanged), so the only
    // observable surface is a compound pick that IS a block root per
    // flattenRuleRoot. Prove that corner is empty on real data, so macro
    // header counts are unchanged everywhere.
    // Mirrors flattenRuleRoot's split; the label heuristic is the real
    // deriveMacros export, so a heuristic change can't make this proof vacuous.
    const blockRoots = (root: AuditNode): AuditNode[] => {
      if (root.ruleNode.kind !== "all" || root.children.length === 0)
        return [root];
      if (!root.children.some(namedGroupLabel)) return [root];
      return root.children;
    };
    const divergences: string[] = [];
    for (const [id, program] of entries) {
      const folded = foldFiniteElectivesIntoRules(program);
      const maximal = allCodes(folded);
      const rand = lcg(0xdead ^ id.length);
      for (const codes of [maximal, maximal.filter(() => rand() < 0.5)]) {
        const audit = compileAudit(
          folded,
          makePlan(codes),
          null,
          new Set(),
          id,
          undefined,
          unitsOf,
        );
        const progress = computeDegreeProgress(
          audit,
          folded,
          unitsOf,
          new Set(),
        );
        const roots = [
          ...(audit.flexibleRoot ? blockRoots(audit.flexibleRoot) : []),
          ...(audit.byTerm
            ? TERM_LETTERS.flatMap((t) =>
                audit.byTerm?.[t] ? blockRoots(audit.byTerm[t]) : [],
              )
            : []),
        ];
        for (const n of roots) {
          if (!isCompoundPick(n)) continue;
          const withFill = nodeProgress(n, progress.nodeFill).satisfied;
          const local = nodeProgress(n).satisfied;
          if (withFill !== local)
            divergences.push(`${id}: fill=${withFill} local=${local}`);
        }
      }
    }
    expect(divergences).toEqual([]);
  });
});

describe("scoreAudit — targeted edge cases", () => {
  it("legality overlay: an illegally-placed required course neither credits nor completes", () => {
    const program = PROGRAMS["h-actuarial-science"];
    const folded = foldFiniteElectivesIntoRules(program);
    const codes = requiredOnly(folded);
    // makePlan uses slot id "s1"; the legality key format is `${slotId}::${code}`.
    const legality = new Set([`s1::${codes[0]}`]);
    check(folded, codes, { programId: "h-actuarial-science", legality });
  });

  it("equivalence twin: a placed cross-listed twin credits the named leaf", () => {
    const equiv = equivalenceForCatalog([
      { code: "amath242", crossListed: ["cs371"] },
      { code: "cs371", crossListed: ["amath242"] },
    ]);
    const program: Program = {
      kind: "flexible",
      name: "Toy",
      asOf: "2026",
      unitPlan: { totalUnits: 1 },
      rules: {
        kind: "all",
        children: [
          { kind: "courses", courses: ["amath242"] },
          { kind: "subjectPool", selectCount: 1, subjectCodes: ["CS"] },
        ],
      },
    };
    const audit = compileAudit(
      program,
      makePlan(["cs371"]),
      null,
      new Set(),
      null,
      equiv,
      unitsOf,
    );
    const progress = computeDegreeProgress(
      audit,
      program,
      unitsOf,
      new Set(),
      equiv,
    );
    const scored = scoreAudit(audit, progress);
    const root = scored.flexible as ScoredNode;
    if (audit.flexibleRoot) verify(root, audit.flexibleRoot, progress, false);
    // The twin fills the NAMED leaf (required-first claim), not the CS pool.
    const [leaf, pool] = root.children;
    expect(leaf.credit).toBe(1);
    expect(leaf.creditedCodes).toEqual(["cs371"]);
    expect(leaf.complete).toBe(true);
    expect(pool.credit).toBe(0);
    expect(pool.complete).toBe(false);
  });

  it("local credit subtracts illegal UNITS from a unit-stated pool, not a course count", () => {
    const program: Program = {
      kind: "flexible",
      name: "Toy",
      asOf: "2026",
      unitPlan: { totalUnits: 1 },
      rules: {
        kind: "all",
        children: [
          {
            kind: "subjectPool",
            selectCount: 2,
            needUnits: 1.0,
            subjectCodes: ["SOC"],
          },
        ],
      },
    };
    const audit = compileAudit(
      program,
      makePlan(["soc401", "soc402"]),
      null,
      new Set(["s1::soc402"]), // soc402 placed illegally
      null,
      undefined,
      unitsOf,
    );
    const root = audit.flexibleRoot;
    if (!root) throw new Error("expected a flexible root");
    // Local-scored (no progress): 1.0 placed units minus the illegal 0.5-unit
    // course leaves 0.5 legal units — NOT 1.0 minus 1 (a course count) = 0.
    const pool = scoreNode(root.children[0]);
    expect(pool.credit).toBe(0.5);
    expect(pool.complete).toBe(false);
  });

  it("a decided compound option isn't zeroed by illegal placements in another option", () => {
    const program: Program = {
      kind: "flexible",
      name: "Toy",
      asOf: "2026",
      unitPlan: { totalUnits: 1 },
      rules: {
        kind: "pick",
        selectMin: 1,
        selectMax: 1,
        children: [
          { kind: "subjectPool", selectCount: 2, subjectCodes: ["STAT"] },
          { kind: "courses", courses: ["econ101"] },
        ],
      },
    };
    const audit = compileAudit(
      program,
      makePlan(["econ101", "stat301", "stat302"]),
      null,
      new Set(["s1::stat301", "s1::stat302"]), // the pool option is all-illegal
      null,
      undefined,
      unitsOf,
    );
    const root = audit.flexibleRoot;
    if (!root) throw new Error("expected a flexible root");
    const scored = scoreNode(root);
    expect(scored.source).toBe("local"); // compound picks always score local
    // One option (ECON 101) is legally met: credit 1/1, decided — the two
    // illegal placements parked in the pool option must not zero the ring.
    expect(scored.credit).toBe(1);
    expect(scored.complete).toBe(true);
  });
});
