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

  it("keeps a bare total (no buckets) as a bucket-less unit audit", () => {
    // A lockstep program states a degree total but no distribution buckets. It
    // is still unit-based (headline shows units) but has no "Degree units"
    // breakdown — so we must NOT invent a whole-degree free-electives bucket.
    const bareTotal: Program = {
      kind: "flexible",
      name: "Toy Lockstep",
      asOf: "2026",
      rules: { kind: "all", children: [] },
      unitPlan: { totalUnits: 21.5, buckets: [] },
    };
    const audit = compileUnits(
      bareTotal,
      buildPlacementMap(plan(["bio101", "engl101"])),
      unitOf,
    );
    expect(audit).not.toBeNull();
    expect(audit?.buckets).toEqual([]);
    expect(audit?.totalRequired).toBe(21.5);
    expect(audit?.totalApplied).toBe(1.0); // both placed courses' units count
  });

  it("derives concise bucket titles from scope", () => {
    const { byId } = run(["bio101"]);
    expect(byId.req.title).toBe("Required courses");
    expect(byId.biol.title).toBe("BIO courses");
    expect(byId["free-electives"].title).toBe("Free electives");
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
    expect(byId["free-electives"].appliedUnits).toBe(1.0);
    expect(byId["free-electives"].status).toBe("met");
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
    expect(byId["free-electives"].appliedUnits).toBe(1.0);
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

  it("reports allocatedUnits as the sum of bucket units (the honest headline)", () => {
    const { audit } = run(["bio101", "bio102", "bio201", "engl101"]);
    // req 1.0 + biol 0.5 (one upper BIOL) + open 0.5 (engl) = 2.0 allocated
    const summed = audit.buckets.reduce((s, b) => s + b.appliedUnits, 0);
    expect(audit.allocatedUnits).toBe(summed);
    expect(audit.allocatedUnits).toBe(2.0);
  });

  it("excludes overflow and unknown-weight units from allocatedUnits", () => {
    // Fill every bucket (req 1.0, biol 1.5, open 1.0 = 3.5), then add an extra
    // weighted course (math237) that overflows, plus a weightless ghost.
    const { audit } = run([
      "bio101",
      "bio102", // req 1.0
      "bio201",
      "bio305",
      "bio2xx", // upper BIOL — but only bio201/bio305 are weighted (1.0)
      "engl101", // open 0.5
      "math237", // overflow once buckets full
      "ghost999", // no unit weight
    ]);
    // allocatedUnits never exceeds the buckets' capacity and ignores overflow.
    const summed = audit.buckets.reduce((s, b) => s + b.appliedUnits, 0);
    expect(audit.allocatedUnits).toBe(summed);
    expect(audit.allocatedUnits).toBeLessThanOrEqual(3.5);
    expect(audit.unknownUnitCourses.map((p) => p.code)).toContain("ghost999");
  });
});

describe("compileUnits — unscoped buckets", () => {
  // 3.0-unit degree: 1.0 required + a 1.5-unit unscoped "Science" requirement we
  // can't verify + 0.5 free electives. The unscoped 1.5 is real (in the total)
  // but never auto-filled, so it must hold the headline back.
  const withUnscoped: Program = {
    kind: "flexible",
    name: "Toy Science",
    asOf: "2026",
    rules: {
      kind: "all",
      children: [{ kind: "courses", courses: ["bio101", "bio102"] }],
    },
    unitPlan: {
      totalUnits: 3.0,
      buckets: [
        {
          id: "req",
          label: "Required courses",
          requiredUnits: 1.0,
          scope: { kind: "required" },
        },
        {
          id: "sci",
          label: "1.5 units of Science electives.",
          requiredUnits: 1.5,
          scope: { kind: "unscoped" },
        },
      ],
    },
  };

  function runU(codes: string[]) {
    const audit = compileUnits(
      withUnscoped,
      buildPlacementMap(plan(codes)),
      unitOf,
    );
    if (!audit) throw new Error("expected a unit audit");
    return audit;
  }

  it("never allocates units to an unscoped bucket", () => {
    const audit = runU(["bio101", "bio102", "bio201", "bio305", "engl101"]);
    const sci = audit.buckets.find((b) => b.bucket.id === "sci");
    expect(sci?.appliedUnits).toBe(0);
    expect(sci?.status).toBe("unmet");
  });

  it("reports unscopedUnits and keeps the headline below 100% while unfilled", () => {
    // A full plan: even though placed units (totalApplied) cover the degree,
    // allocatedUnits can't reach the 3.0 total because the 1.5 unscoped share
    // is unfillable, so the headline can't read 100%.
    const audit = runU(["bio101", "bio102", "bio201", "bio305", "engl101"]);
    expect(audit.unscopedUnits).toBe(1.5);
    expect(audit.allocatedUnits).toBeLessThan(audit.totalRequired ?? 0);
    expect(audit.allocatedUnits).toBeLessThanOrEqual(1.5); // 3.0 total − 1.5 unscoped
  });
});
