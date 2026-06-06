import { describe, expect, it } from "vitest";
import type { LocalPlan } from "../../plan/types";
import { PROGRAMS, type Program } from "../../programs";
import { compileAudit } from "../compile";
import { computeDegreeProgress } from "../progress";

function makePlan(codes: string[]): LocalPlan {
  return {
    schemaVersion: 1,
    programId: "test",
    specializationId: null,
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

/** Compile + score a plan against a program, treating every course as 0.5 unit. */
function progressOf(
  program: Program,
  codes: string[],
  unitsOf: (code: string) => number = () => 0.5,
) {
  const plan = makePlan(codes);
  const audit = compileAudit(program, plan, null, new Set());
  return computeDegreeProgress(audit, program, unitsOf);
}

describe("computeDegreeProgress — required courses", () => {
  const program: Program = {
    kind: "flexible",
    name: "Toy",
    asOf: "2026",
    rules: {
      kind: "all",
      children: [
        { kind: "courses", courses: ["cs115", "math115"] },
        { kind: "courses", courses: ["cs136"] },
      ],
    },
    unitPlan: { totalUnits: 1.5 }, // 3 × 0.5-unit required courses, no free room
  };

  it("reads 0% on an empty plan", () => {
    const p = progressOf(program, []);
    expect(p.pct).toBe(0);
    expect(p.creditedUnits).toBe(0);
    expect(p.totalUnits).toBe(1.5);
    expect(p.denom).toBe(1.5);
    expect(p.allComplete).toBe(false);
  });

  it("reads partial progress in units as courses are placed", () => {
    const p = progressOf(program, ["cs115", "math115"]);
    expect(p.creditedUnits).toBe(1.0); // 2 × 0.5 unit
    expect(p.pct).toBe(67); // 1.0/1.5, held under 100 (cs136 missing)
    expect(p.allComplete).toBe(false);
  });

  it("reads 100% only when every required course is placed", () => {
    const p = progressOf(program, ["cs115", "math115", "cs136"]);
    expect(p.creditedUnits).toBe(1.5);
    expect(p.pct).toBe(100);
    expect(p.allComplete).toBe(true);
  });

  it("credits a sub-0.5-unit course by its real units (exact, no rounding)", () => {
    // cs136 is 0.25 unit, so the 3 named courses use only 1.25 of 1.5 units;
    // 0.25 unit of free-elective room remains, and the bar reads 1.25/1.5.
    const unitsOf = (c: string) => (c === "cs136" ? 0.25 : 0.5);
    const p = progressOf(program, ["cs115", "math115", "cs136"], unitsOf);
    expect(p.freeUnits).toBe(0.25);
    expect(p.denom).toBe(1.5);
    expect(p.creditedUnits).toBe(1.25);
    expect(p.pct).toBe(83); // 1.25/1.5
  });
});

describe("computeDegreeProgress — overlapping elective pools (BME shape)", () => {
  // Three sub-lists whose union is exactly the aggregate "Technical Electives
  // List". Naive counting needs 1+1+3 = 5 courses; the real requirement is 3.
  const program: Program = {
    kind: "flexible",
    name: "Toy",
    asOf: "2026",
    rules: { kind: "all", children: [] },
    electives: [
      { description: "Complete 1 of the following: a", approvedCourses: ["c1", "c2"] },
      { description: "Complete 1 of the following: b", approvedCourses: ["c3"] },
      {
        description: "Technical Electives List",
        requiredCount: 3,
        approvedCourses: ["c1", "c2", "c3"],
      },
    ],
    unitPlan: { totalUnits: 1.5 }, // 3 course-equivalents
  };

  it("credits each course once and reaches 100% with 3 courses", () => {
    const p = progressOf(program, ["c1", "c2", "c3"]);
    expect(p.creditedUnits).toBe(1.5); // 3 × 0.5 unit
    expect(p.pct).toBe(100);
    expect(p.allComplete).toBe(true);
  });

  it("does not double-count a course across the sub-list and aggregate", () => {
    const p = progressOf(program, ["c1", "c2"]);
    expect(p.creditedUnits).toBe(1.0); // not 1.5 from overlapping pools
    expect(p.pct).toBe(67);
  });
});

describe("computeDegreeProgress — free electives", () => {
  const program: Program = {
    kind: "flexible",
    name: "Toy",
    asOf: "2026",
    rules: { kind: "all", children: [{ kind: "courses", courses: ["m1"] }] },
    unitPlan: { totalUnits: 1.5 }, // 3 course-equivalents; 1 named, 2 free
  };

  it("counts any course toward the free-elective room", () => {
    const p = progressOf(program, ["m1", "x1", "x2"]);
    expect(p.freeUnits).toBe(1.0); // 1.5 total − 0.5 named
    expect(p.creditedUnits).toBe(1.5); // 0.5 named + 1.0 free
    expect(p.pct).toBe(100);
    expect(p.allComplete).toBe(true);
  });

  it("cannot reach 100% on free electives alone (named requirement unmet)", () => {
    const p = progressOf(program, ["x1", "x2", "x3", "x4"]);
    expect(p.creditedUnits).toBe(1.0); // only the 1.0 unit of free room, m1 missing
    expect(p.pct).toBe(67);
    expect(p.allComplete).toBe(false);
  });
});

describe("computeDegreeProgress — communication requirement", () => {
  it("counts a not-in-tree communication requirement and gates 100%", () => {
    const program: Program = {
      kind: "flexible",
      name: "Toy",
      asOf: "2026",
      rules: { kind: "all", children: [{ kind: "courses", courses: ["m1"] }] },
      degreeRequirements: {
        name: "Arts",
        communication: { options: ["c1", "c2"] },
      },
      unitPlan: { totalUnits: 1.0 }, // m1 (0.5) + comm (0.5), no free room
    };
    // Without the comm course, its bucket is unfilled → can't read 100%.
    const partial = progressOf(program, ["m1"]);
    expect(partial.creditedUnits).toBe(0.5);
    expect(partial.pct).toBe(50);
    expect(partial.allComplete).toBe(false);
    // Placing one option satisfies it → 100%.
    const full = progressOf(program, ["m1", "c2"]);
    expect(full.creditedUnits).toBe(1.0);
    expect(full.pct).toBe(100);
    expect(full.allComplete).toBe(true);
  });

  it("does not double-count a communication option already in the rules", () => {
    const program: Program = {
      kind: "flexible",
      name: "Toy",
      asOf: "2026",
      rules: { kind: "all", children: [{ kind: "courses", courses: ["c1"] }] },
      degreeRequirements: {
        name: "Science",
        communication: { options: ["c1"] }, // same course the rules already require
      },
      unitPlan: { totalUnits: 0.5 },
    };
    const p = progressOf(program, ["c1"]);
    expect(p.freeUnits).toBe(0); // named = 0.5, not 1.0
    expect(p.creditedUnits).toBe(0.5);
    expect(p.pct).toBe(100);
  });
});

describe("computeDegreeProgress — unit-based subject pool", () => {
  const program: Program = {
    kind: "flexible",
    name: "Toy",
    asOf: "2026",
    rules: { kind: "all", children: [{ kind: "courses", courses: ["m1"] }] },
    electives: [
      {
        description:
          "Complete a minimum of 0.5 unit of BIOL, CHEM, HLTH, or KIN courses at the 200-level or above",
      },
    ],
    unitPlan: { totalUnits: 1.0 }, // m1 (0.5) + pool (0.5)
  };

  it("counts an in-scope course and gates 100%", () => {
    expect(progressOf(program, ["m1"]).pct).toBe(50); // pool unfilled
    const full = progressOf(program, ["m1", "biol250"]);
    expect(full.pct).toBe(100);
    expect(full.allComplete).toBe(true);
  });

  it("rejects an out-of-scope course (wrong level)", () => {
    const p = progressOf(program, ["m1", "biol150"]); // 100-level
    expect(p.pct).toBe(50);
    expect(p.allComplete).toBe(false);
  });
});

describe("computeDegreeProgress — Biomedical Engineering (real data)", () => {
  const bme = PROGRAMS["biomedical-engineering"];

  it("reads 0% on an empty plan with the degree's unit total as denominator", () => {
    const p = progressOf(bme, []);
    expect(p.pct).toBe(0);
    expect(p.totalUnits).toBe(21.88); // straight from unitPlan.totalUnits
    expect(p.denom).toBe(p.totalUnits);
  });

  it("keeps the percentage within [0, 100] for a heavy plan", () => {
    // Pile in lots of catalog codes; the cap must hold.
    const many = Array.from({ length: 80 }, (_, i) => `bme${300 + i}`);
    const p = progressOf(bme, many);
    expect(p.pct).toBeGreaterThanOrEqual(0);
    expect(p.pct).toBeLessThanOrEqual(100);
    expect(Number.isNaN(p.creditedUnits)).toBe(false);
  });
});
