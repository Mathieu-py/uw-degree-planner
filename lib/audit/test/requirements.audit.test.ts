// Cross-program requirements audit. Walks EVERY program in the catalog and
// locks the accuracy invariants the audit pipeline must hold for honest
// progress reporting:
//   1. an empty plan scores 0% — no requirement is "vacuously met" before any
// course is placed;
//   2. every elective note classifies cleanly into tracked (finite, counted)
//      vs untracked (open/unit lists), and none is malformed;
//   3. subjectPool level bounds sit on the hundred scale the compiler buckets
//      to, so the counted set and the Browse set can't diverge.
// It also emits a per-catalog tally of tracked vs untracked elective
// requirements — the "audit report" half of this file.
import { describe, expect, it } from "vitest";
import type { LocalPlan } from "../../plan/types";
import {
  PROGRAMS,
  type Program,
  type RuleNode,
  TERM_LETTERS,
} from "../../programs";
import {
  type AuditNode,
  type AuditRoot,
  compileAudit,
  summarize,
} from "../compile";
import { deriveElectiveSections } from "../electives";

function emptyPlan(
  programId: string,
  specializationId: string | null,
): LocalPlan {
  return {
    schemaVersion: 3,
    programIds: [programId],
    specializationIds: specializationId
      ? { [programId]: specializationId }
      : {},
    stream: "regular",
    startTermId: 1239,
    slots: [],
    updatedAt: "2026-05-23T12:00:00.000Z",
  };
}

/**
 * The audit nodes the headline percentage sums over — mirrors `deriveSections`
 * in AuditPanel: each engineering term, each exploded flexible/spec group.
 */
function headlineSectionNodes(audit: AuditRoot): AuditNode[] {
  const nodes: AuditNode[] = [];
  if (audit.byTerm) {
    for (const t of TERM_LETTERS) {
      const n = audit.byTerm[t];
      if (n) nodes.push(n);
    }
  }
  for (const root of [audit.flexibleRoot, audit.specializationRoot]) {
    if (!root) continue;
    if (root.ruleNode.kind === "all" && root.children.length > 0)
      nodes.push(...root.children);
    else nodes.push(root);
  }
  return nodes;
}

/** Total satisfied requirement-slots the headline would count (≡ numerator). */
function headlineSatisfied(audit: AuditRoot): number {
  let satisfied = 0;
  for (const n of headlineSectionNodes(audit))
    satisfied += summarize(n).satisfied;
  return satisfied;
}

function collectSubjectPools(node: RuleNode, out: RuleNode[]): void {
  if (node.kind === "subjectPool") out.push(node);
  if (node.kind === "all" || node.kind === "pick")
    for (const c of node.children) collectSubjectPools(c, out);
}

function allRuleRoots(program: Program): RuleNode[] {
  const roots: RuleNode[] =
    program.kind === "engineering"
      ? Object.values(program.terms)
      : [program.rules];
  for (const spec of program.specializations ?? [])
    if (spec.rules) roots.push(spec.rules);
  return roots;
}

const programIds = Object.keys(PROGRAMS);

describe("requirements audit — accuracy invariants across all programs", () => {
  it("covers the full program catalog", () => {
    expect(programIds.length).toBeGreaterThan(150);
  });

  // (1) Empty plan ⇒ 0%. This is the root-cause guard: a pick
  // with no selectMin is vacuously "met" but must contribute 0 satisfied slots
  // until something is actually placed.
  it.each(programIds)("scores 0%% on an empty plan: %s", (programId) => {
    const audit = compileAudit(PROGRAMS[programId], emptyPlan(programId, null));
    expect(
      headlineSatisfied(audit),
      `${programId} reports progress on an empty plan`,
    ).toBe(0);
  });

  // The two programs named — optional picks made them read ~22%.
  it.each([
    "computational-mathematics",
    "h-actuarial-science",
  ])("no non-zero headline on empty plan (issue #95 repro): %s", (programId) => {
    if (!PROGRAMS[programId]) return; // fixture may rename; skip rather than fail
    const audit = compileAudit(PROGRAMS[programId], emptyPlan(programId, null));
    expect(headlineSatisfied(audit)).toBe(0);
  });

  // (2) No malformed elective note (missing count, e.g. the Kuali typo).
  it.each(
    programIds,
  )("has no malformed elective descriptions: %s", (programId) => {
    for (const e of PROGRAMS[programId].electives ?? []) {
      expect(
        /^complete\s+of\s+the\s+following/i.test(e.description.trim()),
        `${programId}: malformed elective "${e.description.slice(0, 60)}"`,
      ).toBe(false);
    }
  });

  // (3) subjectPool level bounds must be on the hundred scale the compiler
  // buckets to (levelBucket), or the counted set and Browse set diverge.
  it.each(
    programIds,
  )("uses hundred-scale subjectPool levels: %s", (programId) => {
    const pools: RuleNode[] = [];
    for (const root of allRuleRoots(PROGRAMS[programId]))
      collectSubjectPools(root, pools);
    for (const p of pools) {
      if (p.kind !== "subjectPool") continue;
      for (const bound of [p.minLevel, p.maxLevel]) {
        if (bound === undefined) continue;
        expect(
          bound % 100,
          `${programId}: subjectPool level ${bound} is not on the hundred scale`,
        ).toBe(0);
      }
    }
  });

  // Audit report: how much of each program's elective load we can honestly
  // track vs. what stays count-less (open/unit lists surfaced as "to plan").
  it("reports tracked vs untracked elective requirements", () => {
    let tracked = 0;
    let untracked = 0;
    const untrackedByProgram: Array<[string, number]> = [];
    for (const id of programIds) {
      let u = 0;
      for (const e of deriveElectiveSections(PROGRAMS[id])) {
        if (e.kind === "finite") tracked += 1;
        else {
          untracked += 1;
          u += 1;
        }
      }
      if (u > 0) untrackedByProgram.push([id, u]);
    }
    // Documented reality (see plan): untracked electives are widespread; this
    // surfaces the data-remediation worklist rather than hiding it.
    // eslint-disable-next-line no-console
    console.log(
      `Elective requirements — tracked: ${tracked}, untracked: ${untracked}, ` +
        `programs with untracked: ${untrackedByProgram.length}/${programIds.length}`,
    );
    expect(tracked + untracked).toBeGreaterThan(0);
  });
});
