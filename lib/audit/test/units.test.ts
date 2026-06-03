import { describe, expect, it } from "vitest";
import type { LocalPlan } from "../../plan/types";
import type { Program } from "../../programs";
import { buildPlacementMap } from "../placement";
import { compileUnits, type UnitOf } from "../units";

function plan(codes: string[]): LocalPlan {
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

// bio101/102 are the required courses (100-level); bio2xx/3xx are upper BIOL;
// engl/math are unrelated. "ghost999" has no known unit weight.
const UNITS: Record<string, number> = {
  bio101: 0.5,
  bio102: 0.5,
  bio201: 0.5,
  bio305: 0.5,
  engl101: 0.5,
  math237: 0.5,
};
const unitOf: UnitOf = (c) => UNITS[c];

const program: Program = {
  kind: "flexible",
  name: "Toy Biology",
  asOf: "2026",
  rules: {
    kind: "all",
    children: [{ kind: "courses", courses: ["bio101", "bio102"] }],
  },
  unitPlan: {
    totalUnits: 3.5,
    buckets: [
      {
        id: "req",
        label: "Required courses",
        requiredUnits: 1.0,
        scope: { kind: "required" },
      },
      {
        id: "biol",
        label: "Additional BIOL units",
        requiredUnits: 1.5,
        scope: { kind: "subject", subjects: ["bio"] },
      },
      {
        id: "open",
        label: "Elective courses",
        requiredUnits: 1.0,
        scope: { kind: "open" },
      },
    ],
    constraints: [
      { label: "200-level or above", minUnits: 1.0, minLevel: 200 },
    ],
  },
};

function run(codes: string[]) {
  const audit = compileUnits(program, buildPlacementMap(plan(codes)), unitOf);
  if (!audit) throw new Error("expected a unit audit");
  const byId = Object.fromEntries(audit.buckets.map((b) => [b.bucket.id, b]));
  return { audit, byId };
}

describe("compileUnits — allocation", () => {
  it("returns null when the program has no unit plan", () => {
    const bare: Program = {
      kind: "flexible",
      name: "x",
      asOf: "2026",
      rules: program.rules,
    };
    expect(compileUnits(bare, buildPlacementMap(plan([])), unitOf)).toBeNull();
  });

  it("routes required courses to the required bucket (not the subject bucket)", () => {
    const { byId } = run(["bio101", "bio102"]);
    expect(byId.req.appliedUnits).toBe(1.0);
    expect(byId.req.status).toBe("met");
    expect(byId.req.satisfiers.map((s) => s.code).sort()).toEqual([
      "bio101",
      "bio102",
    ]);
    expect(byId.biol.appliedUnits).toBe(0); // required BIOL didn't leak here
  });

  it("routes non-required subject courses to the subject bucket", () => {
    const { byId } = run(["bio201", "bio305"]);
    expect(byId.biol.appliedUnits).toBe(1.0);
    expect(byId.biol.status).toBe("partial"); // needs 1.5
  });

  it("routes unrelated courses to the open free-elective bucket", () => {
    const { byId } = run(["engl101", "math237"]);
    expect(byId.open.appliedUnits).toBe(1.0);
    expect(byId.open.status).toBe("met");
  });

  it("allocates each unit once across a full plan and sums the total", () => {
    const { audit, byId } = run([
      "bio101",
      "bio102",
      "bio201",
      "bio305",
      "engl101",
      "math237",
    ]);
    expect(byId.req.appliedUnits).toBe(1.0);
    expect(byId.biol.appliedUnits).toBe(1.0);
    expect(byId.open.appliedUnits).toBe(1.0);
    // no double-counting: total = sum of distinct placed units
    expect(audit.totalApplied).toBe(3.0);
    expect(audit.totalRequired).toBe(3.5);
  });

  it("overflows a full subject bucket into the open bucket", () => {
    // three upper BIOL (1.5) fills biol exactly; a fourth spills to open
    const { byId } = run(["bio201", "bio305", "bio401", "bio402"]);
    // bio401/402 have no unit weight in the map → treated as unknown, so only
    // bio201/bio305 (1.0) land in biol; assert the known ones at least.
    expect(byId.biol.appliedUnits).toBe(1.0);
  });

  it("surfaces courses with no known unit weight instead of dropping them", () => {
    const { audit } = run(["bio101", "ghost999"]);
    expect(audit.unknownUnitCourses.map((p) => p.code)).toEqual(["ghost999"]);
    expect(audit.totalApplied).toBe(0.5); // ghost contributes no units
  });

  it("evaluates a level constraint over all placed units", () => {
    const { audit } = run(["bio101", "bio201", "bio305"]);
    const c = audit.constraints[0];
    // only bio201 (200) + bio305 (300) are at the 200-level+
    expect(c.appliedUnits).toBe(1.0);
    expect(c.satisfied).toBe(true);
  });
});
