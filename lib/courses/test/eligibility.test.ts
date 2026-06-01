import { describe, expect, it } from "vitest";
import type { ProgramIdentity } from "@/lib/programs";
import { attachEligibility, type EligibilityRow } from "../eligibility";
import { enrichCourse } from "../filters";
import type { Course, UWFlowCourse } from "../types";

const SYDE: ProgramIdentity = {
  programId: "systems-design-engineering",
  names: ["systems design engineering", "syde"],
  faculty: "engineering",
};

function makeCourse(overrides: Partial<UWFlowCourse> = {}): Course {
  const base: UWFlowCourse = {
    id: 1,
    code: "math116",
    name: "Calculus 1 for Engineering",
    description: null,
    prereqs: null,
    coreqs: null,
    antireqs: null,
    rating: null,
    sections: [],
  };
  return enrichCourse({ ...base, ...overrides });
}

describe("attachEligibility", () => {
  function makeRows(courses: Course[]): EligibilityRow[] {
    return courses.map((course) => ({ course, eligibility: null }));
  }

  it("returns the same array reference when completed is empty", () => {
    const rows = makeRows([makeCourse({ code: "cs136", prereqs: "CS135" })]);
    expect(attachEligibility(rows, new Set(), false)).toBe(rows);
  });

  it("computes non-null eligibility for every row when completed is non-empty", () => {
    const rows = makeRows([makeCourse({ code: "cs136", prereqs: "CS135" })]);
    const result = attachEligibility(rows, new Set(["cs135"]), false);
    expect(result[0].eligibility).not.toBeNull();
    expect(result[0].eligibility?.satisfied).toBe(true);
  });

  it("filters out rows with unmet prereqs when hideUnmetPrereqs=true", () => {
    const rows = makeRows([makeCourse({ code: "cs136", prereqs: "CS135" })]);
    const result = attachEligibility(rows, new Set(["math137"]), true);
    expect(result).toHaveLength(0);
  });

  it("keeps rows with unmet prereqs when hideUnmetPrereqs=false", () => {
    const rows = makeRows([makeCourse({ code: "cs136", prereqs: "CS135" })]);
    const result = attachEligibility(rows, new Set(["math137"]), false);
    expect(result).toHaveLength(1);
    expect(result[0].eligibility?.satisfied).toBe(false);
  });

  it("resolves a level-gated prereq definitively when level is provided", () => {
    // Target level decides "Level at least 2A" instead of "check". Non-empty
    // completed clears the short-circuit; the dummy course isn't the gate.
    const rows = makeRows([
      makeCourse({ code: "cs246", prereqs: "Level at least 2A" }),
    ]);
    const met = attachEligibility(rows, new Set(["cs135"]), false, "2A");
    expect(met[0].eligibility?.satisfied).toBe(true);
    expect(met[0].eligibility?.uncertain).toBe(false);

    const unmet = attachEligibility(rows, new Set(["cs135"]), false, "1B");
    expect(unmet[0].eligibility?.satisfied).toBe(false);
    expect(unmet[0].eligibility?.uncertain).toBe(false);
  });

  it("leaves a level-gated prereq uncertain ('check') when no level is given", () => {
    const rows = makeRows([
      makeCourse({ code: "cs246", prereqs: "Level at least 2A" }),
    ]);
    const result = attachEligibility(rows, new Set(["cs135"]), false);
    expect(result[0].eligibility?.satisfied).toBe(true);
    expect(result[0].eligibility?.uncertain).toBe(true);
  });

  it("hides a level-gated course in an earlier term, keeps it from the qualifying term", () => {
    const rows = makeRows([
      makeCourse({ code: "cs246", prereqs: "Level at least 2A" }),
    ]);
    expect(
      attachEligibility(rows, new Set(["cs135"]), true, "1B"),
    ).toHaveLength(0);
    expect(
      attachEligibility(rows, new Set(["cs135"]), true, "2A"),
    ).toHaveLength(1);
  });

  it("blocks a course reserved to another program for the student's program", () => {
    const rows = makeRows([
      makeCourse({ code: "anth101", prereqs: "Anthropology students only" }),
    ]);
    const result = attachEligibility(
      rows,
      new Set(["cs135"]),
      false,
      undefined,
      SYDE,
    );
    expect(result[0].eligibility?.satisfied).toBe(false);
    expect(result[0].eligibility?.uncertain).toBe(false);
    // Hidden under the default hide-unmet filter.
    expect(
      attachEligibility(rows, new Set(["cs135"]), true, undefined, SYDE),
    ).toHaveLength(0);
  });

  it("keeps a course whose program restriction matches the student", () => {
    const rows = makeRows([
      makeCourse({
        code: "ge101",
        prereqs: "Open only to students in Engineering",
      }),
    ]);
    const result = attachEligibility(
      rows,
      new Set(["cs135"]),
      true,
      undefined,
      SYDE,
    );
    expect(result).toHaveLength(1);
    expect(result[0].eligibility?.satisfied).toBe(true);
    expect(result[0].eligibility?.uncertain).toBe(false);
  });

  it("leaves a program restriction as 'check' when no program is given", () => {
    const rows = makeRows([
      makeCourse({ code: "anth101", prereqs: "Anthropology students only" }),
    ]);
    const result = attachEligibility(rows, new Set(["cs135"]), false);
    expect(result[0].eligibility?.satisfied).toBe(true);
    expect(result[0].eligibility?.uncertain).toBe(true);
  });
});
