import { describe, expect, it } from "vitest";
import { PROGRAMS, type Program } from "../../programs";
import { compileAudit, creditExclusionKeys } from "../compile";
import { deriveElectiveSections } from "../electives";
import { foldFiniteElectivesIntoRules } from "../foldElectives";
import { computeDegreeProgress } from "../progress";
import { makePlan, progressOf } from "./helpers";

describe("computeDegreeProgress — folding a finite list is headline-neutral", () => {
  // A finite "Approved Courses List" counts the same whether it lives in
  // program.electives (a finite bucket) or is folded into the rule tree as a
  // pick (foldFiniteElectivesIntoRules) — same need, same eligible set, so the
  // matcher credits identical units. Options are 0.5-unit here, so the unfilled-
  // slot reservation (uniformUnit vs flat 0.5) is also identical.
  const base: Program = {
    kind: "flexible",
    name: "Toy",
    asOf: "2026",
    rules: {
      kind: "all",
      children: [{ kind: "courses", courses: ["cs115", "math115"] }],
    },
    electives: [
      {
        description: "Approved Courses List",
        requiredCount: 2,
        approvedCourses: ["chem101", "chem102", "chem103", "chem104"],
      },
    ],
    unitPlan: { totalUnits: 3.0 }, // 2 required + 2 picked + 2 free courses
  };
  const folded = foldFiniteElectivesIntoRules(base);

  it("folds (so this is a real before/after comparison)", () => {
    expect(folded).not.toBe(base);
    expect(folded.electives).toEqual([]);
  });

  it.each([
    { label: "empty", codes: [] },
    { label: "partial", codes: ["cs115", "chem101"] },
    {
      label: "named-complete",
      codes: ["cs115", "math115", "chem101", "chem102"],
    },
    {
      label: "over-placed",
      codes: ["cs115", "math115", "chem101", "chem102", "chem103", "chem104"],
    },
  ])("matches pct/creditedUnits/freeUnits/allComplete ($label)", ({
    codes,
  }) => {
    const a = progressOf(base, codes);
    const b = progressOf(folded, codes);
    expect(b.pct).toBe(a.pct);
    expect(b.creditedUnits).toBe(a.creditedUnits);
    expect(b.freeUnits).toBe(a.freeUnits);
    expect(b.allComplete).toBe(a.allComplete);
  });
});

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

describe("computeDegreeProgress — compound pick credits the heavier group", () => {
  // "Complete 1 of: {light} or {heavy}", light listed first but heavy is 1.0 unit.
  // Heaviest-first keeps heavy as the NAMED requirement, so free room is the
  // remainder after 1.0 (not after light's 0.5) and heavy is the group shown to
  // count — instead of arbitrarily crediting whichever Kuali listed first.
  const program: Program = {
    kind: "flexible",
    name: "Compound heavier",
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
              children: [{ kind: "courses", courses: ["light1"] }],
            },
            {
              kind: "all",
              children: [{ kind: "courses", courses: ["heavy1"] }],
            },
          ],
        },
      ],
    },
    unitPlan: { totalUnits: 2.0 }, // one named group + free room
  };
  const unitsOf = (c: string) => (c === "heavy1" ? 1.0 : 0.5);

  it("names the 1.0-unit group even though the 0.5-unit one is listed first", () => {
    const p = progressOf(program, ["light1", "heavy1"], unitsOf);
    expect(p.freeUnits).toBe(1.0); // 2.0 − heavy's 1.0 named, not − light's 0.5
    expect(p.creditedUnits).toBe(1.5); // both placed courses still credit (1.0 + 0.5)
  });
});

describe("computeDegreeProgress — over-satisfied compound pick, saturated free allotment (#104)", () => {
  // finding (3): "1 of {light 0.5} or {heavy 1.0}", BOTH placed, with the
  // free-elective room already full from other courses (leftovers 1.5 > 1.0 room).
  // `creditedUnits` is provably order-independent (= min(placed, total): the
  // uncredited group just spills to the saturated free pool), but heaviest-first
  // still names the 1.0 group — so `freeUnits` is the remainder after 1.0, not 0.5.
  // The old tree-order code (light listed first) reported freeUnits = 1.5.
  const build = (heavyFirst: boolean): Program => ({
    kind: "flexible",
    name: "Saturated compound",
    asOf: "2026",
    rules: {
      kind: "all",
      children: [
        {
          kind: "pick",
          selectMin: 1,
          selectMax: 1,
          children: heavyFirst
            ? [
                {
                  kind: "all",
                  children: [{ kind: "courses", courses: ["heavy1"] }],
                },
                {
                  kind: "all",
                  children: [{ kind: "courses", courses: ["light1"] }],
                },
              ]
            : [
                {
                  kind: "all",
                  children: [{ kind: "courses", courses: ["light1"] }],
                },
                {
                  kind: "all",
                  children: [{ kind: "courses", courses: ["heavy1"] }],
                },
              ],
        },
      ],
    },
    unitPlan: { totalUnits: 2.0 }, // 1.0 named group + 1.0 free room
  });
  const unitsOf = (c: string) => (c === "heavy1" ? 1.0 : 0.5);

  it.each([
    { label: "light listed first", heavyFirst: false },
    { label: "heavy listed first", heavyFirst: true },
  ])("names the heavy group and credits min(placed,total), regardless of order ($label)", ({
    heavyFirst,
  }) => {
    // f1+f2 (1.0) saturate the free room, so the uncredited group overflows a
    // full pool — the case tree-order could have mis-scored.
    const p = progressOf(
      build(heavyFirst),
      ["light1", "heavy1", "f1", "f2"],
      unitsOf,
    );
    expect(p.freeUnits).toBe(1.0); // 2.0 − heavy's 1.0 named (not − light's 0.5)
    expect(p.creditedUnits).toBe(2.0); // min(placed 2.5, total 2.0), order-independent
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

describe("computeDegreeProgress — unit-stated subjectPool scores by units", () => {
  // "Complete 2.0 units of STAT courses" — a unit-stated pool. A 1.0-unit STAT
  // course counts as 1.0 toward the 2.0 need (not as one 0.5 slot), so two
  // 1.0-unit courses satisfy it. The old count model (÷0.5 → selectCount 4)
  // demanded four courses AND let a heavy course eat free-elective budget.
  const program: Program = {
    kind: "flexible",
    name: "Unit pool",
    asOf: "2026",
    rules: {
      kind: "all",
      children: [
        {
          kind: "subjectPool",
          selectCount: 4, // ÷0.5 display approximation
          needUnits: 2.0,
          subjectCodes: ["STAT"],
          minLevel: 200,
        },
      ],
    },
    unitPlan: { totalUnits: 2.0 }, // the pool is the whole (tiny) degree
  };
  const unitsOf = (c: string) => (c.startsWith("stat") ? 1.0 : 0.5);

  it("is satisfied by two 1.0-unit courses (not four), reaching 100%", () => {
    const p = progressOf(program, ["stat230", "stat231"], unitsOf);
    expect(p.creditedUnits).toBe(2.0);
    expect(p.pct).toBe(100);
    expect(p.allComplete).toBe(true);
  });

  it("reads partial progress by units, not by a ÷0.5 course count", () => {
    const p = progressOf(program, ["stat230"], unitsOf); // 1.0 of 2.0 units
    expect(p.creditedUnits).toBe(1.0);
    expect(p.pct).toBe(50);
    expect(p.allComplete).toBe(false);
  });
});

describe("computeDegreeProgress — overlapping unit pools met regardless of order", () => {
  // Two unit-pool electives sharing a course: "0.5 unit of CS or MATH" and
  // "0.5 unit of CS". With cs300 + math300 placed, both are jointly satisfiable
  // (CS → the CS-only pool, MATH → the other). Most-constrained-first assignment
  // reaches 100% no matter which pool is declared first; the old list-order
  // greedy stranded the second pool at 99%.
  const csOrMath = {
    description:
      "Complete a minimum of 0.5 unit of CS or MATH courses at the 200-level or above",
  };
  const csOnly = {
    description:
      "Complete a minimum of 0.5 unit of CS courses at the 200-level or above",
  };
  const build = (electives: { description: string }[]): Program => ({
    kind: "flexible",
    name: "Overlap pools",
    asOf: "2026",
    rules: { kind: "all", children: [] },
    electives,
    unitPlan: { totalUnits: 1.0 }, // two 0.5-unit pools, no free room
  });

  it.each([
    { label: "cs-or-math first", electives: [csOrMath, csOnly] },
    { label: "cs-only first", electives: [csOnly, csOrMath] },
  ])("reaches 100% with the shared course ($label)", ({ electives }) => {
    const p = progressOf(build(electives), ["cs300", "math300"]);
    expect(p.allComplete).toBe(true);
    expect(p.pct).toBe(100);
  });
});

describe("computeDegreeProgress — weighted-tie unit pools route the heavy course", () => {
  // Three pools, need 0.5 CS + 1.0 CS-or-MATH + 0.5 MATH = 2.0. The only satisfying
  // assignment sends the 1.0-unit cs300 to the pool that needs a whole unit; the
  // 0.5s fill the rest. A weight-blind greedy lets the 0.5-unit CS pool grab cs300
  // (over-filling it) and strands the 1.0 pool at 0.5 → stuck at 99%.
  const csOnly = {
    description:
      "Complete a minimum of 0.5 unit of CS courses at the 200-level or above",
  };
  const csOrMath = {
    description:
      "Complete a minimum of 1.0 unit of CS or MATH courses at the 200-level or above",
  };
  const mathOnly = {
    description:
      "Complete a minimum of 0.5 unit of MATH courses at the 200-level or above",
  };
  const build = (electives: { description: string }[]): Program => ({
    kind: "flexible",
    name: "Weighted overlap",
    asOf: "2026",
    rules: { kind: "all", children: [] },
    electives,
    unitPlan: { totalUnits: 2.0 }, // 0.5 + 1.0 + 0.5, no free room
  });
  const units = (c: string) => (c === "cs300" ? 1.0 : 0.5); // cs300 is full-year

  it.each([
    { label: "cs-only first", electives: [csOnly, csOrMath, mathOnly] },
    { label: "big pool first", electives: [csOrMath, csOnly, mathOnly] },
    { label: "reversed", electives: [mathOnly, csOrMath, csOnly] },
  ])("reaches 100% independent of order ($label)", ({ electives }) => {
    const p = progressOf(
      build(electives),
      ["cs300", "cs310", "math300"],
      units,
    );
    expect(p.allComplete).toBe(true);
    expect(p.pct).toBe(100);
  });
});

describe("computeDegreeProgress — a pick doesn't burn a unit pool's course", () => {
  // phase boundary: "1 of {cs300, engl100}" + "0.5 unit of CS", cs300 the
  // pool's ONLY eligible course. The matcher defers pool-eligible courses
  // (matchLast), so the pick takes engl100 whichever way its options are
  // ordered — previously list order decided between 99% and 100%.
  const build = (options: string[]): Program => ({
    kind: "flexible",
    name: "Phase boundary",
    asOf: "2026",
    rules: {
      kind: "all",
      children: [
        {
          kind: "pick",
          selectMin: 1,
          selectMax: 1,
          children: [{ kind: "courses", courses: options }],
        },
      ],
    },
    electives: [
      {
        description:
          "Complete a minimum of 0.5 unit of CS courses at the 200-level or above",
      },
    ],
    unitPlan: { totalUnits: 1.0 },
  });

  it.each([
    { label: "pool course first", options: ["cs300", "engl100"] },
    { label: "pool course last", options: ["engl100", "cs300"] },
  ])("reaches 100% ($label)", ({ options }) => {
    const p = progressOf(build(options), ["cs300", "engl100"]);
    expect(p.pct).toBe(100);
    expect(p.allComplete).toBe(true);
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
  // conflict. The UW Calendar Glossary defines an antirequisite as "Degree
  // credit will not be granted for both the antirequisite course and a course
  // naming it as such." — i.e. exactly one of the pair counts, so the headline
  // must credit 0.5, not 0. Source: UW Undergraduate Calendar, Glossary of
  // Terms (Antirequisite),
  // https://academic-calendar-archive.uwaterloo.ca/undergraduate-studies/2020-2021/page/uWaterloo-Undergraduate-Calendar-Glossary-of-Terms.html
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
    expect(p.owedUnverified).toEqual([
      "A co-op work-term sequence (not audited here).",
    ]);
  });

  it("reaches 100% once the unverified requirement is acknowledged (#116)", () => {
    // Manual confirmation: "couldn't auto-verify" ≠ "unmet". An acked rule stops
    // gating, so a volume-complete plan reads 100% instead of an indefinite 99%.
    const acked = new Set(["A co-op work-term sequence (not audited here)."]);
    const p = progressOf(program, ["m1"], () => 0.5, new Set(), acked);
    expect(p.allComplete).toBe(true);
    expect(p.pct).toBe(100);
    expect(p.owedUnverified).toEqual([]);
  });

  it("ignores an acknowledgement that doesn't match any requirement", () => {
    const acked = new Set(["some other rule that isn't on this program"]);
    const p = progressOf(program, ["m1"], () => 0.5, new Set(), acked);
    expect(p.pct).toBe(99);
    expect(p.owedUnverified).toHaveLength(1);
  });
});

describe("computeDegreeProgress — a selected spec's owed requirements gate too (#123)", () => {
  // Volume is full, but the SELECTED specialization carries an owed requirement
  // the parser couldn't structure. It must gate the headline exactly like the
  // program's own would, so the spec can't read 100% with a real requirement lost.
  const program: Program = {
    kind: "flexible",
    name: "Toy",
    asOf: "2026",
    rules: { kind: "all", children: [{ kind: "courses", courses: ["m1"] }] },
    unitPlan: { totalUnits: 0.5 },
  };
  const SPEC_REQ =
    "Complete the specialization capstone (confirm with advisor).";

  it("stays below 100% while a spec requirement is owed", () => {
    const p = progressOf(program, ["m1"], () => 0.5, new Set(), new Set(), [
      SPEC_REQ,
    ]);
    expect(p.creditedUnits).toBe(0.5); // volume full
    expect(p.allComplete).toBe(false);
    expect(p.pct).toBe(99);
    expect(p.owedUnverified).toEqual([SPEC_REQ]);
  });

  it("reaches 100% once the spec requirement is acknowledged", () => {
    const p = progressOf(
      program,
      ["m1"],
      () => 0.5,
      new Set(),
      new Set([SPEC_REQ]),
      [SPEC_REQ],
    );
    expect(p.allComplete).toBe(true);
    expect(p.pct).toBe(100);
    expect(p.owedUnverified).toEqual([]);
  });

  it("dedupes a spec text that coincides with the program's own", () => {
    // Same verbatim text on both → one owed entry (and one checkbox upstream),
    // not a double-count.
    const withOwn: Program = { ...program, unverifiedRequirements: [SPEC_REQ] };
    const p = progressOf(withOwn, ["m1"], () => 0.5, new Set(), new Set(), [
      SPEC_REQ,
    ]);
    expect(p.owedUnverified).toEqual([SPEC_REQ]);
  });
});

describe("computeDegreeProgress — 100% requires full volume, not just gates", () => {
  // `allComplete` can hold while free-elective units are still unplaced; the
  // headline must NOT round a ~99.5% plan up to a false 100. A near-full single
  // credit against a slightly larger denom reproduces the Math.round edge.
  const program: Program = {
    kind: "flexible",
    name: "Rounding",
    asOf: "2026",
    rules: { kind: "all", children: [{ kind: "courses", courses: ["m1"] }] },
    unitPlan: { totalUnits: 100.5 }, // m1 (100.0) + 0.5 free room
  };
  const unitsOf = (c: string) => (c === "m1" ? 100.0 : 0.5);

  it("holds at 99% when volume is short even though every gate is met", () => {
    const p = progressOf(program, ["m1"], unitsOf);
    expect(p.allComplete).toBe(true); // the sole named bucket is filled
    expect(p.creditedUnits).toBe(100.0);
    expect(p.denom).toBe(100.5); // 0.5 unit of volume still owed
    expect(p.pct).toBe(99); // not the rounded-up 100
  });

  it("reaches 100% once the remaining free unit is placed", () => {
    const p = progressOf(program, ["m1", "free1"], unitsOf);
    expect(p.creditedUnits).toBe(100.5);
    expect(p.pct).toBe(100);
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

describe("computeDegreeProgress — threaded electiveSections", () => {
  // buildProgramAudit derives the elective sections once and passes the SAME
  // array to both computeDegreeProgress and deriveMacros, so electiveCredit[i]
  // stays aligned to the i-th elective. Passing that array must be identical to
  // deriving it internally (transparency), and the param must actually be used.
  const program = Object.values(PROGRAMS).find((p) =>
    deriveElectiveSections(p).some(
      (s) => s.kind === "finite" || s.kind === "subjectPool",
    ),
  );
  const auditFor = (p: Program, codes: string[]) =>
    compileAudit(
      p,
      makePlan(codes),
      null,
      new Set(),
      null,
      undefined,
      () => 0.5,
    );

  it("passing the derived sections matches internal derivation", () => {
    if (!program)
      throw new Error("snapshot has no program with elective buckets");
    const sections = deriveElectiveSections(program);
    // Touch a few finite-elective options so the elective buckets are exercised.
    const codes = [
      ...new Set(
        sections.flatMap((s) =>
          s.kind === "finite" ? s.options.slice(0, 2) : [],
        ),
      ),
    ].slice(0, 6);
    const audit = auditFor(program, codes);
    const passed = computeDegreeProgress(
      audit,
      program,
      () => 0.5,
      new Set(),
      undefined,
      new Set(),
      sections,
    );
    const derived = computeDegreeProgress(
      audit,
      program,
      () => 0.5,
      new Set(),
      undefined,
      new Set(),
    );
    expect(passed).toEqual(derived);
  });

  it("honors the passed array — empty sections drop the elective buckets", () => {
    if (!program)
      throw new Error("snapshot has no program with elective buckets");
    const audit = auditFor(program, []);
    const empty = computeDegreeProgress(
      audit,
      program,
      () => 0.5,
      new Set(),
      undefined,
      new Set(),
      [],
    );
    const derived = computeDegreeProgress(
      audit,
      program,
      () => 0.5,
      new Set(),
      undefined,
      new Set(),
    );
    expect(empty).not.toEqual(derived);
  });
});
