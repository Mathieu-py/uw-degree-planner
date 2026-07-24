import { describe, expect, it } from "vitest";
import { poolMatch } from "../../courses/code";
import type { LocalPlan } from "../../plan/types";
import { PROGRAMS } from "../../programs/registry";
import { type AuditNode, type AuditRoot, compileAudit } from "../compile";
import { computeDegreeProgress } from "../progress";

/**
 * Stress tests driven by the real program catalog (data/programs.json) and real
 * course codes (data/courses.1269.json). These guard the audit's behavior on
 * the actual UW requirement shapes, not just toy fixtures.
 */

function planWith(programId: string, codes: string[]): LocalPlan {
  return {
    schemaVersion: 3,
    programIds: [programId],
    specializationIds: {},
    stream: "regular",
    startTermId: 1239,
    slots: [
      {
        id: "s1",
        termId: 1239,
        position: "1A",
        isCoop: false,
        courses: codes.map((c) => ({ code: c })),
      },
    ],
    updatedAt: "2026-05-23T12:00:00.000Z",
  };
}

/** Depth-first find the first node of a given rule kind. */
function findNode(root: AuditNode | null, kind: string): AuditNode | undefined {
  if (!root) return undefined;
  if (root.ruleNode.kind === kind) return root;
  for (const c of root.children) {
    const found = findNode(c, kind);
    if (found) return found;
  }
  return undefined;
}

function rootsOf(audit: AuditRoot): AuditNode[] {
  return [
    audit.flexibleRoot,
    audit.specializationRoot,
    ...(audit.byTerm ? Object.values(audit.byTerm) : []),
  ].filter((n): n is AuditNode => n != null);
}

describe("real subjectPool — Anthropology '3.0 units of ANTH at the 300-level'", () => {
  // 3g-anthropology rules include: subjectPool { selectCount: 6, needUnits: 3.0,
  // subjectCodes: ["ANTH"], minLevel: 300 } — a unit-stated pool, so it
  // scores by UNITS. A 200-level ANTH course must NOT satisfy it.
  const program = PROGRAMS["3g-anthropology"];

  it("the program and its 300-level ANTH pool exist as expected", () => {
    expect(program).toBeDefined();
    expect(program.kind).toBe("flexible");
  });

  it("counts only ANTH courses at the 300-level toward the pool", () => {
    const anth300 = [
      "anth300",
      "anth302",
      "anth303",
      "anth305",
      "anth309",
      "anth311",
    ];
    const plan = planWith("3g-anthropology", [
      ...anth300,
      "anth201", // 200-level: must NOT count toward the 300+ pool
      "anth204", // required course elsewhere in the tree, also 200-level
    ]);
    const audit = compileAudit(program, plan);
    const pool = rootsOf(audit)
      .map((r) => findNode(r, "subjectPool"))
      .find(Boolean);
    expect(pool).toBeDefined();
    // Exactly the six 300-level ANTH courses satisfy it (the 200-levels don't).
    expect(pool?.satisfiers.length).toBe(6);
    // Unit-stated pool → satisfiedCount is placed UNITS: 6 × 0.5 = 3.0.
    expect(pool?.satisfiedCount).toBe(3);
  });

  it("poolMatch enforces the 300-level floor on the real filter", () => {
    const f = { subjects: new Set(["anth"]), minLevel: 300 };
    expect(poolMatch("anth300", f)).toBe(true);
    expect(poolMatch("anth320", f)).toBe(true);
    expect(poolMatch("anth201", f)).toBe(false);
    expect(poolMatch("hist300", f)).toBe(false); // wrong subject
  });
});

describe("real programs — headline invariants on empty plans", () => {
  // The cross-program guardrail (progress.crossprogram.test.ts) sweeps all 194;
  // here we pin a few representative real denominators explicitly.
  const cases: Array<[string, number]> = [
    ["3g-anthropology", 15],
    ["3g-classical-studies", 15],
    ["3g-communication-studies", 15],
  ];

  for (const [id, total] of cases) {
    it(`${id}: empty plan reads 0% against a finite ${total}-unit denominator`, () => {
      const program = PROGRAMS[id];
      expect(program).toBeDefined();
      const audit = compileAudit(program, planWith(id, []));
      const p = computeDegreeProgress(audit, program, () => 0.5);
      expect(p.pct).toBe(0);
      expect(p.creditedUnits).toBe(0);
      expect(p.denom).toBe(total);
      expect(Number.isNaN(p.pct)).toBe(false);
      expect(p.allComplete).toBe(false);
    });
  }
});
