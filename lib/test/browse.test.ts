import { describe, expect, it } from "vitest";
import { attachEligibility, type BrowseRow } from "../browse";
import { enrichCourse } from "../filters";
import type { Course, UWFlowCourse } from "../types";

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
  function makeRows(courses: Course[]): BrowseRow[] {
    return courses.map((course) => ({ course, eligibility: null }));
  }

  it("returns the same array reference when completed is empty", () => {
    const rows = makeRows([makeCourse({ code: "cs136", prereqs: "CS135" })]);
    expect(attachEligibility(rows, [], false)).toBe(rows);
  });

  it("computes non-null eligibility for every row when completed is non-empty", () => {
    const rows = makeRows([makeCourse({ code: "cs136", prereqs: "CS135" })]);
    const result = attachEligibility(rows, ["cs135"], false);
    expect(result[0].eligibility).not.toBeNull();
    expect(result[0].eligibility?.satisfied).toBe(true);
  });

  it("filters out rows with unmet prereqs when hideUnmetPrereqs=true", () => {
    const rows = makeRows([makeCourse({ code: "cs136", prereqs: "CS135" })]);
    const result = attachEligibility(rows, ["math137"], true);
    expect(result).toHaveLength(0);
  });

  it("keeps rows with unmet prereqs when hideUnmetPrereqs=false", () => {
    const rows = makeRows([makeCourse({ code: "cs136", prereqs: "CS135" })]);
    const result = attachEligibility(rows, ["math137"], false);
    expect(result).toHaveLength(1);
    expect(result[0].eligibility?.satisfied).toBe(false);
  });
});
