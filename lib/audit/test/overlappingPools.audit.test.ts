import { describe, expect, it } from "vitest";
import { deriveMacros } from "../../../components/planner/audit/deriveMacros";
import type { LocalPlan } from "../../plan/types";
import { PROGRAMS, type Program } from "../../programs";
import { compileAudit } from "../compile";
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
    const { macros } = deriveMacros(
      audit,
      program,
      progress.freeUnits,
      progress.breadthRequirements,
      progress.levelFloors,
      unitsOf,
      new Set(),
      progress.nodeFill,
    );
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

  it("adding a distinct ENGL course fills the pool and reaches 100%", () => {
    const { progress, degreeCount } = run(["engl101", "engl102"]);
    expect(progress.allComplete).toBe(true);
    expect(progress.pct).toBe(100);
    expect(degreeCount).toEqual({ satisfied: 2, needed: 2 });
  });
});

describe("English – Literature and Rhetoric (3-year): real program", () => {
  const program = PROGRAMS["3g-english-literature-and-rhetoric"];

  function run(codes: string[]) {
    const audit = compileAudit(program, makePlan(codes), null, new Set());
    const progress = computeDegreeProgress(audit, program, unitsOf, new Set());
    const { macros } = deriveMacros(
      audit,
      program,
      progress.freeUnits,
      progress.breadthRequirements,
      progress.levelFloors,
      unitsOf,
      new Set(),
      progress.nodeFill,
    );
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
    // The 3 distinct ENGL courses fill the 3 previously-stranded rule slots
    // (the two ENGL pools). Any residual gap is the separate, legitimately-unmet
    // communication requirement — not the overlap bug.
    expect(better.degree?.satisfied).toBe((base.degree?.satisfied ?? 0) + 3);
  });
});
