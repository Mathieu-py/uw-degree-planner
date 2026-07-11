import { describe, expect, it } from "vitest";
import { deriveMacros } from "../../../components/planner/audit/deriveMacros";
import { unitsMet } from "../../format";
import { PROGRAMS, TERM_LETTERS } from "../../programs";
import { deriveCommunicationRequirement } from "../communication";
import { compileAudit } from "../compile";
import { foldFiniteElectivesIntoRules } from "../foldElectives";
import { computeDegreeProgress } from "../progress";
import { type ScoredAudit, type ScoredNode, scoreAudit } from "../score";
import { lcg } from "./fuzzRand";
import { allCodes, makePlan, mixedUnitsOf, requiredOnly } from "./helpers";

const unitsOf = () => 0.5;

function roots(scored: ScoredAudit): ScoredNode[] {
  return [
    ...(scored.flexible ? [scored.flexible] : []),
    ...(scored.specialization ? [scored.specialization] : []),
    ...(scored.byTerm
      ? TERM_LETTERS.flatMap((t) =>
          scored.byTerm?.[t] ? [scored.byTerm[t]] : [],
        )
      : []),
  ];
}

function eachScored(s: ScoredNode, visit: (n: ScoredNode) => void): void {
  visit(s);
  for (const c of s.children) eachScored(c, visit);
}

/**
 * Structural contract of the scored tree — holds for every program and plan,
 * with no reference to the pre-refactor code paths (those live in the parity
 * suite's frozen oracle):
 *  - credit is bounded by [0, needed];
 *  - creditedCodes are real placed courses, each appearing in at most ONE
 *    subtree at any sibling level (one course, one slot);
 *  - local nodes carry no credited codes;
 *  - children stay index-aligned with the compiled tree.
 */
describe("scoreAudit — structural invariants, every real program", () => {
  const entries = Object.entries(PROGRAMS);

  it("credit bounds, code provenance, sibling disjointness, tree alignment", {
    timeout: 60_000,
  }, () => {
    for (const [id, program] of entries) {
      const folded = foldFiniteElectivesIntoRules(program);
      const maximal = allCodes(folded);
      const rand = lcg(0xbeef ^ id.length);
      const cases: Array<[string[], (code: string) => number]> = [
        [[], unitsOf],
        [requiredOnly(folded), unitsOf],
        [maximal, unitsOf],
        [maximal.filter(() => rand() < 0.5), unitsOf],
        [maximal, mixedUnitsOf],
      ];
      for (const [codes, weigh] of cases) {
        const audit = compileAudit(
          folded,
          makePlan(codes),
          null,
          new Set(),
          id,
          undefined,
          weigh,
        );
        const progress = computeDegreeProgress(audit, folded, weigh, new Set());
        const placed = new Set(audit.placement.keys());
        const scored = scoreAudit(audit, progress);
        for (const root of roots(scored)) {
          eachScored(root, (s) => {
            expect(s.credit).toBeGreaterThanOrEqual(0);
            expect(s.credit).toBeLessThanOrEqual(s.needed);
            expect(s.children).toHaveLength(s.node.children.length);
            if (s.source === "local") expect(s.creditedCodes).toEqual([]);
            for (const code of s.creditedCodes)
              expect(placed.has(code)).toBe(true);
            // One course, one slot: sibling subtrees never share a credit.
            const seen = new Set<string>();
            for (const child of s.children)
              for (const code of new Set(child.creditedCodes)) {
                expect(seen.has(code)).toBe(false);
                seen.add(code);
              }
          });
        }
        // Roots share the same match, so credits are disjoint across them too.
        const perRoot = roots(scored).map((r) => new Set(r.creditedCodes));
        for (let i = 0; i < perRoot.length; i++)
          for (let j = i + 1; j < perRoot.length; j++)
            for (const code of perRoot[i])
              expect(perRoot[j].has(code)).toBe(false);
      }
    }
  });

  it("progress omitted ⇒ every node is local", () => {
    for (const [, program] of entries) {
      const folded = foldFiniteElectivesIntoRules(program);
      const audit = compileAudit(folded, makePlan(allCodes(folded)));
      for (const root of roots(scoreAudit(audit)))
        eachScored(root, (s) => {
          expect(s.source).toBe("local");
        });
    }
  });

  it("the degree macro's header count is the sum of its scored blocks (+ minima)", {
    timeout: 60_000,
  }, () => {
    for (const [id, program] of entries) {
      const folded = foldFiniteElectivesIntoRules(program);
      const codes = allCodes(folded);
      const audit = compileAudit(
        folded,
        makePlan(codes),
        null,
        new Set(),
        id,
        undefined,
        unitsOf,
      );
      const progress = computeDegreeProgress(audit, folded, unitsOf, new Set());
      const { macros } = deriveMacros(audit, folded, unitsOf, new Set(), {
        progress,
      });
      const degree = macros.find((m) => m.key === "degree");
      if (!degree?.count) continue;
      // Blocks carry the scored nodes the cards render — the header count
      // must be exactly their sum plus the "Degree minimums" rows
      // (communication + level floors), never an independent tally.
      let satisfied = 0;
      for (const block of degree.blocks)
        if (block.content.kind === "node")
          satisfied += block.content.scored.credit;
      // Mirror deriveMacros: the comm row's match credit and the epsilon-
      // tolerant floor check (a raw >= only coincides at flat 0.5 weights).
      // Legality is empty here, so raw placement keys suffice.
      const placedCodes = new Set(audit.placement.keys());
      const comm = deriveCommunicationRequirement(folded, placedCodes);
      if (comm && !comm.alreadyInTree)
        satisfied += Math.min(progress.commCredit ?? comm.placed, comm.need);
      for (const f of progress.levelFloors)
        satisfied += unitsMet(f.placedUnits, f.need) ? 1 : 0;
      expect(degree.count.satisfied).toBe(satisfied);
    }
  });
});
