import { describe, expect, it } from "vitest";
import {
  deriveLevelFloors,
  isLevelFloor,
  parseLevelFloor,
} from "@/lib/audit/levelFloors";
import { PROGRAMS, type Program, type UnitConstraint } from "@/lib/programs";

const c = (sourceText: string): UnitConstraint => ({ label: "Floor", sourceText });

describe("parseLevelFloor", () => {
  it("parses a plain units-at-level floor", () => {
    const f = parseLevelFloor(c("A minimum of 14.5 units must be at the 200-level or above."));
    expect(f?.need).toBe(14.5);
    expect(f?.minLevel).toBe(200);
    expect(f?.maxLevel).toBeUndefined();
    expect(f?.subjects).toBeUndefined();
  });

  it("captures an exclusion list", () => {
    const f = parseLevelFloor(
      c("3.0 units must be lecture courses at the 300-level or above (excluding SCI courses)."),
    );
    expect(f?.need).toBe(3.0);
    expect(f?.minLevel).toBe(300);
    expect(f?.excludeSubjects).toEqual(["sci"]);
  });

  it("captures a subject include-list", () => {
    const f = parseLevelFloor(
      c("0.5 unit of additional BIOL or EARTH courses, at the 300-level or above."),
    );
    expect(f?.subjects).toEqual(["biol", "earth"]);
    expect(f?.minLevel).toBe(300);
  });

  it("returns null for non-floor constraints", () => {
    expect(parseLevelFloor(c("Maintain a 60% major average."))).toBeNull();
    expect(parseLevelFloor(c("Humanities — 1.0 unit: CLAS, ENGL"))).toBeNull(); // no level
    expect(isLevelFloor(c("1.0 unit at the 200-level or above"))).toBe(true);
  });
});

describe("deriveLevelFloors", () => {
  const program = {
    kind: "flexible",
    name: "T",
    asOf: "2026",
    rules: { kind: "all", children: [] },
    unitPlan: {
      totalUnits: 20,
      constraints: [c("2.0 units must be at the 300-level or above.")],
    },
  } as unknown as Program;

  it("sums placed units at/above the level bound", () => {
    const floors = deriveLevelFloors(
      program,
      ["bio350", "bio360", "bio250", "engl101"],
      () => 0.5,
    );
    // bio350 + bio360 are 300+, bio250/engl101 are below → 1.0 unit placed.
    expect(floors).toHaveLength(1);
    expect(floors[0].placedUnits).toBe(1.0);
    expect(floors[0].need).toBe(2.0);
  });
});

describe("level floors — real data coverage", () => {
  it("detects the faculty floors that exist in the catalog", () => {
    let total = 0;
    const withFloors: string[] = [];
    for (const [id, program] of Object.entries(PROGRAMS)) {
      const n = deriveLevelFloors(program, [], () => 0.5).length;
      if (n > 0) withFloors.push(id);
      total += n;
    }
    // Survey of data/programs.json: 19 level-floor constraints across 12 programs.
    expect(total).toBeGreaterThanOrEqual(18);
    expect(withFloors.length).toBeGreaterThanOrEqual(11);
    expect(withFloors).toContain("h-science");
    expect(withFloors).toContain("knowledge-integration");
  });
});
