import { describe, expect, it } from "vitest";
import type { LocalPlan } from "../../plan/types";
import type { Program } from "../../programs";
import { compileAudit } from "../compile";
import { creditExclusionKeys, type PlacementIssue } from "../creditExclusion";
import { computeDegreeProgress } from "../progress";

/**
 * Stress tests for degree-credit unit counting and antireq credit exclusion.
 *
 * Antireq rule (UW Glossary): "Degree credit cannot be obtained for both the
 * antirequisite and the course(s) naming it as such." So a placed antireq
 * pair/clique credits EXACTLY ONE member — never zero, never both.
 * Source: https://ucalendar.uwaterloo.ca/9900/INTRO/glossary.html
 */

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

/** Build a symmetric antireq issue set: every member conflicts with the rest. */
function clique(slotId: string, codes: string[]): PlacementIssue[] {
  return codes.map((c) => ({
    slotId,
    courseCode: c,
    kind: "antireq",
    conflictsWith: codes.filter((o) => o !== c),
  }));
}

describe("antireq keeper priority (creditExclusionKeys)", () => {
  it("keeps the program-referenced member even when the other has more units", () => {
    // Pair {aaa100 (referenced, 0.5u), bbb100 (not referenced, 1.0u)}. The
    // program requires aaa100, so it must be the one credited; bbb100 excluded.
    const keys = creditExclusionKeys(clique("s1", ["aaa100", "bbb100"]), {
      referenced: new Set(["aaa100"]),
      unitsOf: (c) => (c === "bbb100" ? 1.0 : 0.5),
    });
    expect([...keys]).toEqual(["s1::bbb100"]);
  });

  it("keeps the higher-unit member when neither is program-referenced", () => {
    const keys = creditExclusionKeys(clique("s1", ["aaa100", "bbb100"]), {
      referenced: new Set(),
      unitsOf: (c) => (c === "bbb100" ? 1.0 : 0.5),
    });
    expect([...keys]).toEqual(["s1::aaa100"]); // aaa100 (lower units) excluded
  });

  it("breaks a units tie by code ascending", () => {
    const keys = creditExclusionKeys(clique("s1", ["zzz100", "aaa100"]), {
      referenced: new Set(),
      unitsOf: () => 0.5,
    });
    expect([...keys]).toEqual(["s1::zzz100"]); // aaa100 kept (asc), zzz100 excluded
  });

  it("a 3-way antireq clique keeps exactly one, excludes the other two", () => {
    const keys = creditExclusionKeys(
      clique("s1", ["aaa100", "bbb100", "ccc100"]),
      {
        referenced: new Set(),
        unitsOf: () => 0.5,
      },
    );
    expect(keys.size).toBe(2); // one kept, two excluded
    expect(keys.has("s1::aaa100")).toBe(false); // aaa100 kept (code asc)
    expect(keys.has("s1::bbb100")).toBe(true);
    expect(keys.has("s1::ccc100")).toBe(true);
  });

  it("credits exactly one unit's worth of a 3-clique in the headline", () => {
    const program: Program = {
      kind: "flexible",
      name: "Clique",
      asOf: "2026",
      rules: {
        kind: "pick",
        selectMin: 1,
        selectMax: 1,
        children: [
          { kind: "courses", courses: ["aaa100", "bbb100", "ccc100"] },
        ],
      },
      unitPlan: { totalUnits: 0.5 },
    };
    const legality = creditExclusionKeys(
      clique("s1", ["aaa100", "bbb100", "ccc100"]),
      { referenced: new Set(), unitsOf: () => 0.5 },
    );
    const p = progressOf(
      program,
      ["aaa100", "bbb100", "ccc100"],
      () => 0.5,
      legality,
    );
    expect(p.creditedUnits).toBe(0.5);
    expect(p.pct).toBe(100);
  });
});

describe("unit counting — mixed credit weights", () => {
  const program: Program = {
    kind: "flexible",
    name: "Weights",
    asOf: "2026",
    rules: {
      kind: "all",
      children: [
        { kind: "courses", courses: ["full100"] }, // 1.0u full-year
        { kind: "courses", courses: ["lab100"] }, // 0.25u lab
        { kind: "courses", courses: ["std100"] }, // 0.5u standard
      ],
    },
    unitPlan: { totalUnits: 1.75 }, // 1.0 + 0.25 + 0.5, no free room
  };
  const unitsOf = (c: string) =>
    c === "full100" ? 1.0 : c === "lab100" ? 0.25 : 0.5;

  it("credits each required course by its exact catalog units", () => {
    const p = progressOf(program, ["full100", "lab100", "std100"], unitsOf);
    expect(p.creditedUnits).toBe(1.75);
    expect(p.pct).toBe(100);
    expect(p.allComplete).toBe(true);
  });

  it("never exceeds 100% / denom even with surplus placed courses", () => {
    const p = progressOf(
      program,
      ["full100", "lab100", "std100", "extra1", "extra2"],
      unitsOf,
    );
    expect(p.creditedUnits).toBeLessThanOrEqual(p.denom);
    expect(p.pct).toBeLessThanOrEqual(100);
  });
});

describe("unit counting — unfilled pick reserves its options' real units", () => {
  // A pick of two 1.0-unit (full-year) options, plus 1.0 unit of free room.
  // When the pick is unfilled, it must reserve 1.0 unit (its options' weight),
  // not a flat 0.5 — otherwise free-elective room is overstated and stray
  // electives credit progress the student hasn't really earned.
  const program: Program = {
    kind: "flexible",
    name: "FullYearPick",
    asOf: "2026",
    rules: {
      kind: "pick",
      selectMin: 1,
      selectMax: 1,
      children: [{ kind: "courses", courses: ["fy100", "fy200"] }],
    },
    unitPlan: { totalUnits: 2.0 }, // 1.0 (the pick) + 1.0 free room
  };
  const unitsOf = (c: string) => (c === "fy100" || c === "fy200" ? 1.0 : 0.5);

  it("reserves the full unit so stray electives can't overstate progress", () => {
    // Pick unfilled; three 0.5u free electives placed. Free room is 1.0, so only
    // 1.0 unit of electives may credit → 50%, not 75%.
    const p = progressOf(program, ["e1", "e2", "e3"], unitsOf);
    expect(p.freeUnits).toBe(1.0);
    expect(p.creditedUnits).toBe(1.0);
    expect(p.pct).toBe(50);
    expect(p.allComplete).toBe(false);
  });
});

describe("unit-based subject-pool electives (issue #101)", () => {
  // "Complete 1.0 unit of HIST courses at the 200-level or above" — scored by
  // UNITS, not a 0.5-derived count. A single 1.0-unit course must satisfy it.
  const program: Program = {
    kind: "flexible",
    name: "PoolByUnits",
    asOf: "2026",
    rules: { kind: "all", children: [] },
    electives: [
      {
        description:
          "Complete 1.0 unit of HIST courses at the 200-level or above",
      },
    ],
    unitPlan: { totalUnits: 1.0 },
  };

  it("a single 1.0-unit course satisfies a '1.0 unit of X' pool (100%)", () => {
    // Old behavior: need = 1.0/0.5 = 2 slots, so one course filled 1 of 2 →
    // stuck at 99%, never complete. Unit scoring reaches 100% on one placement.
    const p = progressOf(program, ["hist300"], (c) =>
      c === "hist300" ? 1.0 : 0.5,
    );
    expect(p.creditedUnits).toBe(1.0);
    expect(p.pct).toBe(100);
    expect(p.allComplete).toBe(true);
  });

  it("two 0.5-unit courses also cover the 1.0-unit pool", () => {
    const p = progressOf(program, ["hist300", "hist310"], () => 0.5);
    expect(p.pct).toBe(100);
    expect(p.allComplete).toBe(true);
  });

  it("counts a 0.25-unit course for exactly its weight (partial, not a whole slot)", () => {
    // One 0.25 course covers only half of the 1.0-unit pool → still incomplete,
    // and it credits 0.25, not a rounded-up 0.5.
    const p = progressOf(program, ["hist300"], () => 0.25);
    expect(p.creditedUnits).toBe(0.25);
    expect(p.allComplete).toBe(false);
    expect(p.pct).toBeLessThan(100);
  });

  it("an out-of-scope course (wrong level) doesn't count toward the pool", () => {
    const p = progressOf(program, ["hist101"], () => 1.0); // 100-level
    expect(p.allComplete).toBe(false);
    expect(p.pct).toBeLessThan(100);
  });
});
