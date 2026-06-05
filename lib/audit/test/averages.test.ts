import { describe, expect, it } from "vitest";
import type { Course } from "../../courses/types";
import type { LocalPlan } from "../../plan/types";
import type { Program } from "../../programs";
import { computeAverages } from "../averages";
import { compileAudit } from "../compile";

/** Minimal Course — averages only reads `units`. */
function course(code: string, units: number): Course {
  return { code, units } as unknown as Course;
}

function catalog(...entries: [string, number][]): Map<string, Course> {
  return new Map(entries.map(([c, u]) => [c, course(c, u)]));
}

function plan(slots: LocalPlan["slots"]): LocalPlan {
  return {
    schemaVersion: 1,
    programId: "test",
    specializationId: null,
    stream: "regular",
    startTermId: 1239,
    slots,
    updatedAt: "2026-05-23T12:00:00.000Z",
  };
}

function slot(
  id: string,
  termId: number | null,
  position: LocalPlan["slots"][number]["position"],
  courses: { code: string; grade?: string }[],
): LocalPlan["slots"][number] {
  return { id, termId, position, isCoop: false, courses };
}

// Major rules credit cs115/cs136/cs246; phys121 is a non-major elective.
const program: Program = {
  kind: "flexible",
  name: "Toy",
  asOf: "2026",
  rules: {
    kind: "all",
    children: [{ kind: "courses", courses: ["cs115", "cs136", "cs246"] }],
  },
};

describe("computeAverages", () => {
  it("computes unit-weighted cumulative and major percentages", () => {
    const p = plan([
      slot("s1", 1239, "1A", [
        { code: "cs115", grade: "90" },
        { code: "cs136", grade: "80" },
      ]),
      slot("s2", 1241, "1B", [
        { code: "cs246", grade: "85" },
        { code: "phys121", grade: "70" }, // elective — counts cumulative only
      ]),
    ]);
    const cat = catalog(
      ["cs115", 0.5],
      ["cs136", 0.5],
      ["cs246", 0.5],
      ["phys121", 0.5],
    );
    const audit = compileAudit(program, p);
    const { cumulative, major } = computeAverages(p, cat, audit);
    expect(cumulative.value).toBe(81.3); // (90+80+85+70)/4 = 81.25 → 81.3
    expect(cumulative.countedCourses).toBe(4);
    expect(major.value).toBe(85); // (90+80+85)/3
    expect(major.countedCourses).toBe(3);
  });

  it("weights by catalog units (a 1.0-unit course counts double)", () => {
    const p = plan([
      slot("s1", 1239, "1A", [
        { code: "cs115", grade: "100" }, // 1.0 unit
        { code: "cs136", grade: "70" }, // 0.5
        { code: "cs246", grade: "70" }, // 0.5
      ]),
    ]);
    const cat = catalog(["cs115", 1.0], ["cs136", 0.5], ["cs246", 0.5]);
    const audit = compileAudit(program, p);
    // (100*1 + 70*.5 + 70*.5) / 2.0 = 170/2 = 85
    expect(computeAverages(p, cat, audit).cumulative.value).toBe(85);
  });

  it("returns null (not yet computable) below the minimum graded count", () => {
    const p = plan([
      slot("s1", 1239, "1A", [
        { code: "cs115", grade: "90" },
        { code: "cs136", grade: "80" },
      ]),
    ]);
    const cat = catalog(["cs115", 0.5], ["cs136", 0.5]);
    const audit = compileAudit(program, p);
    const { cumulative } = computeAverages(p, cat, audit);
    expect(cumulative.value).toBeNull();
    expect(cumulative.countedCourses).toBe(2);
  });

  it("excludes non-numeric grades, transfers, and in-progress courses", () => {
    const p = plan([
      slot("pre", null, "pre", [{ code: "math137", grade: "TR" }]),
      slot("s1", 1239, "1A", [
        { code: "cs115", grade: "90" },
        { code: "cs136", grade: "CR" }, // credit, no number
        { code: "cs246", grade: "" }, // in progress
        { code: "stat230", grade: "80" },
        { code: "phys121", grade: "70" },
      ]),
    ]);
    const cat = catalog(
      ["math137", 0.5],
      ["cs115", 0.5],
      ["cs136", 0.5],
      ["cs246", 0.5],
      ["stat230", 0.5],
      ["phys121", 0.5],
    );
    const audit = compileAudit(program, p);
    const { cumulative } = computeAverages(p, cat, audit);
    // Only cs115/stat230/phys121 carry numbers → (90+80+70)/3 = 80
    expect(cumulative.value).toBe(80);
    expect(cumulative.countedCourses).toBe(3);
  });

  it("counts a repeated course once (most recent placement wins)", () => {
    const p = plan([
      slot("s1", 1239, "1A", [
        { code: "cs115", grade: "55" },
        { code: "cs136", grade: "80" },
      ]),
      slot("s2", 1241, "1B", [
        { code: "cs115", grade: "95" }, // retake — overrides the earlier 55
        { code: "cs246", grade: "90" },
      ]),
    ]);
    const cat = catalog(["cs115", 0.5], ["cs136", 0.5], ["cs246", 0.5]);
    const audit = compileAudit(program, p);
    const { cumulative } = computeAverages(p, cat, audit);
    // (95+80+90)/3 = 88.33 → 88.3, NOT averaging in the 55
    expect(cumulative.value).toBe(88.3);
    expect(cumulative.countedCourses).toBe(3);
  });
});
