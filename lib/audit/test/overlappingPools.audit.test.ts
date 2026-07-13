import { describe, expect, it } from "vitest";
import { deriveMacros } from "../../../components/planner/audit/deriveMacros";
import type { LocalPlan } from "../../plan/types";
import type { Program } from "../../programs";
import { PROGRAMS } from "../../programsRegistry";
import { type AuditNode, compileAudit } from "../compile";
import { computeDegreeProgress } from "../progress";

function makePlan(codes: string[]): LocalPlan {
  return {
    schemaVersion: 3,
    programIds: ["test"],
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

const unitsOf = () => 0.5;

/**
 * Regression for the "bar stuck below 100% while every requirement row is green"
 * bug. A `subjectPool` ("one additional ENGL course") overlaps a named requirement
 * ("ENGL 101"): the panel ROWS used to score each node independently against the
 * full placement, so one ENGL course was credited toward BOTH — rows read fully
 * met. The unit headline assigns each course to ONE slot (maxBipartiteMatch), so
 * it correctly left the pool unfilled and capped the bar. The two now agree: the
 * row count reflects the same distinct one-course-per-requirement assignment.
 */
describe("overlapping subjectPool vs. named requirement", () => {
  // 1.0 unit total: one required ENGL course + one ADDITIONAL ENGL course.
  const program: Program = {
    kind: "flexible",
    name: "Toy English",
    asOf: "2026",
    unitPlan: { totalUnits: 1 },
    rules: {
      kind: "all",
      children: [
        { kind: "courses", courses: ["engl101"] },
        {
          kind: "subjectPool",
          selectCount: 1,
          subjectCodes: ["ENGL"],
          minLevel: 100,
        },
      ],
    },
  };

  function run(codes: string[]) {
    const plan = makePlan(codes);
    const audit = compileAudit(program, plan, null, new Set(), "test");
    const progress = computeDegreeProgress(audit, program, unitsOf, new Set());
    const { macros } = deriveMacros(audit, program, unitsOf, new Set(), {
      progress,
    });
    const degree = macros.find((m) => m.key === "degree");
    return { progress, degreeCount: degree?.count };
  }

  it("one ENGL course can't fill both the named slot AND the additional pool", () => {
    const { progress, degreeCount } = run(["engl101"]);
    // The pool genuinely needs a SECOND, distinct ENGL course.
    expect(progress.allComplete).toBe(false);
    expect(progress.pct).toBeLessThan(100);
    // Row count now matches: 1 of 2 (was 2 of 2 under independent scoring).
    expect(degreeCount).toEqual({ satisfied: 1, needed: 2 });
  });

  it("the NAMED requirement claims the shared course, not the pool", () => {
    // "1 additional ENGL course" is beyond the named ENGL 101 (calendar wording:
    // "Complete N additional … courses"), so the single placed course must
    // credit the named slot and leave the POOL row unmet — not the reverse.
    const plan = makePlan(["engl101"]);
    const audit = compileAudit(program, plan, null, new Set(), "test");
    const progress = computeDegreeProgress(audit, program, unitsOf, new Set());
    const root = audit.flexibleRoot;
    if (!root) throw new Error("expected a flexible root");
    const [namedLeaf, pool] = root.children;
    expect(progress.nodeFill.get(namedLeaf)).toBe(1);
    expect(progress.nodeFill.get(pool) ?? 0).toBe(0);
    // And the assigned-codes map agrees: the course belongs to the named row.
    expect(progress.nodeAssigned.get(namedLeaf)).toEqual(["engl101"]);
    expect(progress.nodeAssigned.get(pool)).toBeUndefined();
  });

  it("adding a distinct ENGL course fills the pool and reaches 100%", () => {
    const { progress, degreeCount } = run(["engl101", "engl102"]);
    expect(progress.allComplete).toBe(true);
    expect(progress.pct).toBe(100);
    expect(degreeCount).toEqual({ satisfied: 2, needed: 2 });

    const plan = makePlan(["engl101", "engl102"]);
    const audit = compileAudit(program, plan, null, new Set(), "test");
    const p = computeDegreeProgress(audit, program, unitsOf, new Set());
    const root = audit.flexibleRoot;
    if (!root) throw new Error("expected a flexible root");
    const [namedLeaf, pool] = root.children;
    expect(p.nodeAssigned.get(namedLeaf)).toEqual(["engl101"]);
    expect(p.nodeAssigned.get(pool)).toEqual(["engl102"]);
  });
});

describe("Actuarial Science (Honours): required courses vs. 'additional' pools", () => {
  const program = PROGRAMS["h-actuarial-science"];

  // The program's required core — includes ACTSC 431/446 (400-level ACTSC) and
  // several 300/400-level math-faculty courses, ALL filter-eligible for the
  // plan's "Complete N additional …" subject pools.
  const requiredCore = [
    "actsc231",
    "actsc232",
    "actsc331",
    "actsc363",
    "actsc372",
    "actsc431",
    "actsc446",
    "afm101",
    "econ101",
    "econ102",
    "engl378",
    "mthel131",
    "stat330",
    "stat331",
    "stat333",
    "stat341",
  ];

  function poolNodes(root: AuditNode): AuditNode[] {
    const out: AuditNode[] = [];
    const walk = (n: AuditNode) => {
      if (n.ruleNode.kind === "subjectPool") out.push(n);
      for (const c of n.children) walk(c);
    };
    walk(root);
    return out;
  }

  it("placing only the required core credits NO 'additional' pool", () => {
    const audit = compileAudit(
      program,
      makePlan(requiredCore),
      null,
      new Set(),
    );
    const progress = computeDegreeProgress(audit, program, unitsOf, new Set());
    const root = audit.flexibleRoot;
    if (!root) throw new Error("expected a flexible root");
    const pools = poolNodes(root);
    // 2× ACTSC@400, 1× 300–400 math-faculty, 2× ACTSC (any level).
    expect(pools.length).toBeGreaterThanOrEqual(3);
    for (const pool of pools) {
      expect(progress.nodeFill.get(pool) ?? 0).toBe(0);
      expect(progress.nodeAssigned.get(pool)).toBeUndefined();
    }
  });

  it("a distinct extra 400-level ACTSC credits exactly one pool", () => {
    const audit = compileAudit(
      program,
      makePlan([...requiredCore, "actsc445"]),
      null,
      new Set(),
    );
    const progress = computeDegreeProgress(audit, program, unitsOf, new Set());
    const root = audit.flexibleRoot;
    if (!root) throw new Error("expected a flexible root");
    const credited = poolNodes(root).filter(
      (p) => (progress.nodeFill.get(p) ?? 0) > 0,
    );
    expect(credited).toHaveLength(1);
    expect(progress.nodeAssigned.get(credited[0])).toEqual(["actsc445"]);
  });
});

describe("English – Literature and Rhetoric (3-year): real program", () => {
  const program = PROGRAMS["3g-english-literature-and-rhetoric"];

  function run(codes: string[]) {
    const audit = compileAudit(program, makePlan(codes), null, new Set());
    const progress = computeDegreeProgress(audit, program, unitsOf, new Set());
    const { macros } = deriveMacros(audit, program, unitsOf, new Set(), {
      progress,
    });
    const degree = macros.find((m) => m.key === "degree")?.count;
    return { progress, degree };
  }

  // Satisfy every NAMED requirement (the two required courses + all five picks)
  // but place NO extra ENGL beyond them. The program ALSO requires "two ENGL
  // courses at the 100-level" and "one additional ENGL course at the 200-level
  // or above" (UW calendar) — three distinct ENGL courses the named picks can't
  // also count toward. Under the old independent scoring those pools re-counted
  // the named courses and the rows read fully met; the headline (one course per
  // slot) correctly stayed below 100%, leaving the bar stuck with green rows.
  const namedOnly = [
    "engl200a",
    "engl251", // required
    "engl373",
    "engl225", // pick 2-of (list A)
    "engl305a",
    "engl311", // pick 2-of (list B)
    "engl200b", // pick 1-of {200b,200c}
    "engl292", // pick 1-of {292,306a}
    "engl309a", // pick 1-of {309a,309c}
  ];

  it("reproduces the stuck bar and surfaces the gap on the degree rows", () => {
    const { progress, degree } = run(namedOnly);
    // Bar can't reach 100%: the ENGL pools have no distinct courses left.
    expect(progress.pct).toBeLessThan(100);
    // And the requirement rows no longer falsely read fully met — the gap shows.
    expect(degree).toBeTruthy();
    expect(degree?.satisfied).toBeLessThan(degree?.needed ?? 0);
  });

  it("adding distinct extra ENGL courses moves the bar and the row count up", () => {
    const base = run(namedOnly);
    // 3 more distinct ENGL @200+ not used by any named requirement above.
    const better = run([...namedOnly, "engl210e", "engl340", "engl361"]);
    expect(better.progress.pct).toBeGreaterThan(base.progress.pct);
    // The 3 distinct ENGL courses fill the two previously-stranded ENGL pools,
    // which are unit-stated: needUnits 1.0 + 0.5 = 1.5 units, so the
    // degree row's satisfied total rises by 1.5 (units), not by 3 (courses). Any
    // residual gap is the separate communication requirement — not the overlap bug.
    expect(better.degree?.satisfied).toBe((base.degree?.satisfied ?? 0) + 1.5);
  });
});
