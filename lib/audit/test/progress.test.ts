import { describe, expect, it } from "vitest";
import type { LocalPlan } from "../../plan/types";
import { PROGRAMS, type Program } from "../../programs";
import { compileAudit, creditExclusionKeys } from "../compile";
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

/** Compile + score a plan against a program, treating every course as 0.5 unit. */
function progressOf(
  program: Program,
  codes: string[],
  unitsOf: (code: string) => number = () => 0.5,
  legality: ReadonlySet<string> = new Set(),
) {
  const plan = makePlan(codes);
  const audit = compileAudit(program, plan, null, legality);
  return computeDegreeProgress(audit, program, unitsOf, legality);
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

  it("excludes an illegally-placed course from credit and from 100%", () => {
    // All three placed, but cs136 sits before its prereqs (slot "s1"): it still
    // shows met-but-flagged on its row, but must not credit the headline.
    const legality = new Set(["s1::cs136"]);
    const p = progressOf(
      program,
      ["cs115", "math115", "cs136"],
      () => 0.5,
      legality,
    );
    expect(p.creditedUnits).toBe(1.0); // cs136's 0.5 unit not counted
    expect(p.pct).toBe(67);
    expect(p.allComplete).toBe(false);
    // Fixing the placement (no legality issue) restores full credit.
    expect(progressOf(program, ["cs115", "math115", "cs136"]).pct).toBe(100);
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

describe("computeDegreeProgress — excluded courses", () => {
  const program: Program = {
    kind: "flexible",
    name: "Toy w/ exclusion",
    asOf: "2026",
    rules: {
      kind: "all",
      children: [
        { kind: "courses", courses: ["cs115"] },
        { kind: "excluded", courses: ["phys999"] },
      ],
    },
    unitPlan: { totalUnits: 1.0 }, // cs115 (0.5) + 0.5 free-elective room
  };

  it("never credits a course barred by an `excluded` rule", () => {
    // phys999 is placed but the program bars it from counting — it must not
    // fill the free-elective room (which would falsely read 100%).
    const barred = progressOf(program, ["cs115", "phys999"]);
    expect(barred.creditedUnits).toBe(0.5); // only cs115
    expect(barred.pct).toBe(50);
    // A legitimate free elective DOES fill that same room.
    const ok = progressOf(program, ["cs115", "free200"]);
    expect(ok.creditedUnits).toBe(1.0);
    expect(ok.pct).toBe(100);
  });
});

describe("computeDegreeProgress — pick whose option is a subjectPool", () => {
  // "Complete 1 of: {1 SOC course at the 400-level} or {…}" — the option is a
  // subjectPool, not a course leaf. A placed in-scope course must satisfy it.
  const program: Program = {
    kind: "flexible",
    name: "Toy w/ pick-of-pool",
    asOf: "2026",
    rules: {
      kind: "all",
      children: [
        {
          kind: "pick",
          selectMin: 1,
          selectMax: 1,
          children: [
            {
              kind: "subjectPool",
              selectCount: 1,
              subjectCodes: ["SOC"],
              minLevel: 400,
            },
          ],
        },
      ],
    },
    unitPlan: { totalUnits: 0.5 },
  };

  it("is satisfied by a course matching the pick's subjectPool option", () => {
    expect(progressOf(program, []).pct).toBe(0);
    const p = progressOf(program, ["soc450"]); // SOC, 400-level → matches the pool
    expect(p.creditedUnits).toBe(0.5);
    expect(p.pct).toBe(100);
    expect(p.allComplete).toBe(true);
  });
});

describe("computeDegreeProgress — compound pick (option is an `all` group)", () => {
  // "Complete 1 of: {csa and csb} or {csc and csd}". Each option is a full group,
  // so a single placed course must NOT satisfy the pick — `collect` used to flatten
  // every pick's leaves into one pool, which let one course complete the group.
  const program: Program = {
    kind: "flexible",
    name: "Toy compound pick",
    asOf: "2026",
    rules: {
      kind: "all",
      children: [
        {
          kind: "pick",
          selectMin: 1,
          selectMax: 1,
          children: [
            {
              kind: "all",
              children: [
                { kind: "courses", courses: ["csa"] },
                { kind: "courses", courses: ["csb"] },
              ],
            },
            {
              kind: "all",
              children: [
                { kind: "courses", courses: ["csc"] },
                { kind: "courses", courses: ["csd"] },
              ],
            },
          ],
        },
      ],
    },
    unitPlan: { totalUnits: 1.0 }, // one satisfied option = two 0.5-unit courses
  };

  it("a single course does not complete the option-group", () => {
    const p = progressOf(program, ["csa"]);
    expect(p.allComplete).toBe(false);
    expect(p.pct).toBeLessThan(100);
  });

  it("completing one full option-group reaches 100%", () => {
    const p = progressOf(program, ["csa", "csb"]);
    expect(p.creditedUnits).toBe(1.0);
    expect(p.pct).toBe(100);
    expect(p.allComplete).toBe(true);
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
      {
        description: "Complete 1 of the following: a",
        approvedCourses: ["c1", "c2"],
      },
      {
        description: "Complete 1 of the following: b",
        approvedCourses: ["c3"],
      },
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

describe("computeDegreeProgress — unit fidelity for pool/elective slots (T1.3)", () => {
  const program: Program = {
    kind: "flexible",
    name: "Toy",
    asOf: "2026",
    rules: { kind: "all", children: [] },
    electives: [
      {
        description: "Complete 1 of the following: X",
        approvedCourses: ["big100"],
      },
    ],
    unitPlan: { totalUnits: 2.0 },
  };
  const unitsOf = (c: string) => (c === "big100" ? 1.0 : 0.5);

  it("reserves a filled 1.0-unit elective as a full unit (not a flat 0.5)", () => {
    const p = progressOf(program, ["big100"], unitsOf);
    expect(p.creditedUnits).toBe(1.0);
    expect(p.freeUnits).toBe(1.0); // 2.0 total − 1.0 real, not 1.5
  });

  it("estimates an unfilled elective slot at ~0.5 unit", () => {
    const p = progressOf(program, [], unitsOf);
    expect(p.freeUnits).toBe(1.5); // 2.0 − 0.5 estimate (option unknown until picked)
  });
});

describe("computeDegreeProgress — level floors gate completion", () => {
  const program: Program = {
    kind: "flexible",
    name: "Toy",
    asOf: "2026",
    rules: { kind: "all", children: [{ kind: "courses", courses: ["m1"] }] },
    unitPlan: {
      totalUnits: 1.0, // m1 (0.5) + 0.5 free
      constraints: [
        {
          label: "Upper level",
          sourceText: "0.5 unit must be at the 200-level or above.",
        },
      ],
    },
  };

  it("holds below 100% while a level floor is unmet, even with full volume", () => {
    const p = progressOf(program, ["m1", "engl101"]); // both 100-level
    expect(p.creditedUnits).toBe(1.0); // degree volume is full
    expect(p.levelFloors[0].placedUnits).toBe(0);
    expect(p.allComplete).toBe(false);
    expect(p.pct).toBe(99); // would be 100, held by the unmet floor
  });

  it("reaches 100% once the floor is satisfied", () => {
    const p = progressOf(program, ["m1", "bio250"]); // bio250 is 200-level
    expect(p.levelFloors[0].placedUnits).toBe(0.5);
    expect(p.allComplete).toBe(true);
    expect(p.pct).toBe(100);
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

describe("computeDegreeProgress — optimal overlapping-pool matching", () => {
  // Two overlapping picks that ARE jointly satisfiable: "1 of {A,C}" declared
  // first, then "2 of {A,B}", with A,B,C all placed. Optimal: A,B fill the
  // 2-pick and C fills the 1-pick → both met. The old most-constrained-first
  // greedy (stable order) gave the 1-pick the A that the 2-pick needed, leaving
  // it unfilled and the headline stuck at 99%. Maximum matching can't strand it.
  const program: Program = {
    kind: "flexible",
    name: "Overlap",
    asOf: "2026",
    rules: {
      kind: "all",
      children: [
        {
          kind: "pick",
          selectMin: 1,
          selectMax: 1,
          children: [{ kind: "courses", courses: ["aaa100", "ccc100"] }],
        },
        {
          kind: "pick",
          selectMin: 2,
          selectMax: 2,
          children: [{ kind: "courses", courses: ["aaa100", "bbb100"] }],
        },
      ],
    },
    unitPlan: { totalUnits: 1.5 }, // 3 slots × 0.5, no free room
  };

  it("fills both overlapping picks when jointly satisfiable", () => {
    const p = progressOf(program, ["aaa100", "bbb100", "ccc100"]);
    expect(p.allComplete).toBe(true);
    expect(p.pct).toBe(100);
    expect(p.creditedUnits).toBe(1.5);
  });

  it("still reports unmet when genuinely not satisfiable", () => {
    // Only A,B placed: the 2-pick takes both, the 1-pick {A,C} has nothing left.
    const p = progressOf(program, ["aaa100", "bbb100"]);
    expect(p.allComplete).toBe(false);
  });
});

describe("computeDegreeProgress — antireq conflict credits one member", () => {
  // "Choose one of aaa100 / bbb200" — they're antireqs, so both placed is a
  // conflict. UW grants credit for one → the headline must credit 0.5, not 0.
  const program: Program = {
    kind: "flexible",
    name: "Toy",
    asOf: "2026",
    rules: {
      kind: "pick",
      selectMin: 1,
      selectMax: 1,
      children: [{ kind: "courses", courses: ["aaa100", "bbb200"] }],
    },
    unitPlan: { totalUnits: 0.5 },
  };

  it("credits exactly one of an antireq pair (not zero, not both)", () => {
    const issues = [
      {
        slotId: "s1",
        courseCode: "aaa100",
        kind: "antireq",
        conflictsWith: ["bbb200"],
      },
      {
        slotId: "s1",
        courseCode: "bbb200",
        kind: "antireq",
        conflictsWith: ["aaa100"],
      },
    ];
    const legality = creditExclusionKeys(issues, {
      referenced: new Set(),
      unitsOf: () => 0.5,
    });
    // Only one member excluded → the other is credited.
    expect(legality.size).toBe(1);
    const p = progressOf(program, ["aaa100", "bbb200"], () => 0.5, legality);
    expect(p.creditedUnits).toBe(0.5);
    expect(p.pct).toBe(100);
  });
});

describe("computeDegreeProgress — breadth gates completion", () => {
  const program: Program = {
    kind: "flexible",
    name: "Toy",
    asOf: "2026",
    rules: { kind: "all", children: [{ kind: "courses", courses: ["m1"] }] },
    unitPlan: {
      totalUnits: 1.0, // m1 (0.5) + 0.5 free
      constraints: [
        {
          label: "Humanities",
          sourceText: "Humanities — 0.5 unit: HIST, ENGL",
        },
      ],
    },
  };

  it("holds below 100% while a breadth subject is unmet, even at full volume", () => {
    const p = progressOf(program, ["m1", "math101"]); // neither is HIST/ENGL
    expect(p.creditedUnits).toBe(1.0); // degree volume is full
    expect(p.breadthRequirements[0].placedUnits).toBe(0);
    expect(p.allComplete).toBe(false);
    expect(p.pct).toBe(99); // would be 100, held by the unmet breadth
  });

  it("reaches 100% once a breadth course is placed", () => {
    const p = progressOf(program, ["m1", "hist101"]); // hist101 satisfies Humanities
    expect(p.breadthRequirements[0].placedUnits).toBe(0.5);
    expect(p.allComplete).toBe(true);
    expect(p.pct).toBe(100);
  });
});

describe("computeDegreeProgress — several gates owed at once", () => {
  // Volume is full and no breadth/floor is owed, but the program still carries
  // an unverified requirement — completion waits on every gate together.
  const program: Program = {
    kind: "flexible",
    name: "Toy",
    asOf: "2026",
    rules: { kind: "all", children: [{ kind: "courses", courses: ["m1"] }] },
    unitPlan: { totalUnits: 0.5 },
    unverifiedRequirements: ["A co-op work-term sequence (not audited here)."],
  };

  it("stays below 100% while an unverified requirement is owed", () => {
    const p = progressOf(program, ["m1"]);
    expect(p.creditedUnits).toBe(0.5); // volume full
    expect(p.allComplete).toBe(false);
    expect(p.pct).toBe(99);
  });
});

describe("computeDegreeProgress — degenerate inputs", () => {
  it("returns a zeroed headline when there is no program", () => {
    const plan = makePlan(["cs100", "cs200"]);
    const audit = compileAudit(null, plan);
    const p = computeDegreeProgress(audit, null, () => 0.5);
    expect(p.totalUnits).toBeNull();
    expect(p.denom).toBe(0);
    expect(p.creditedUnits).toBe(0);
    expect(p.pct).toBe(0); // denom 0 is guarded — no NaN
    expect(p.freeUnits).toBe(0);
    expect(p.breadthRequirements).toEqual([]);
    expect(p.levelFloors).toEqual([]);
  });

  it("never divides by zero when a program states no unit total", () => {
    const program: Program = {
      kind: "flexible",
      name: "No total",
      asOf: "2026",
      rules: { kind: "all", children: [] }, // no requirements, no totalUnits
    };
    const p = progressOf(program, []);
    expect(p.denom).toBe(0);
    expect(p.pct).toBe(0);
    expect(Number.isNaN(p.pct)).toBe(false);
  });
});
