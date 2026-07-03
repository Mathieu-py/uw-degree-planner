import { describe, expect, it } from "vitest";
import type { Program } from "../../lib/programs";
import { foldFreeElectivesIntoUnverified } from "../scrape-programs";

/** A minimal flexible Program; `over` sets unitPlan / unverifiedRequirements. */
const prog = (over: Partial<Program> = {}): Program =>
  ({
    kind: "flexible",
    name: "Test",
    asOf: "2026",
    rules: { kind: "all", children: [] },
    ...over,
  }) as Program;

const FE = "Complete 4 approved electives";

describe("foldFreeElectivesIntoUnverified", () => {
  it("surfaces dropped free electives for a program with no totalUnits", () => {
    // No unit headline → the dropped volume is untracked, so it must be surfaced
    // or the audit could read 100% with the electives unaccounted.
    const programs = { p: prog() };
    foldFreeElectivesIntoUnverified(programs, new Map([["p", [FE]]]));
    expect(programs.p.unverifiedRequirements).toEqual([FE]);
  });

  it("suppresses them when the program has a totalUnits denominator", () => {
    const programs = { p: prog({ unitPlan: { totalUnits: 20 } }) };
    foldFreeElectivesIntoUnverified(programs, new Map([["p", [FE]]]));
    expect(programs.p.unverifiedRequirements).toBeUndefined();
  });

  it("merges with existing unverified requirements and dedupes", () => {
    const programs = { p: prog({ unverifiedRequirements: ["X", FE] }) };
    foldFreeElectivesIntoUnverified(programs, new Map([["p", [FE, "Y"]]]));
    expect(programs.p.unverifiedRequirements).toEqual(["X", FE, "Y"]);
  });

  it("skips an unknown slug without throwing", () => {
    const programs: Record<string, Program> = {};
    expect(() =>
      foldFreeElectivesIntoUnverified(programs, new Map([["missing", [FE]]])),
    ).not.toThrow();
  });
});
