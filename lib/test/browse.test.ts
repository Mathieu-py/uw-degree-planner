import { describe, expect, it } from "vitest";
import { attachEligibility, type BrowseRow, buildBrowseRows } from "../browse";
import { DEFAULT_PURE_FILTERS } from "../filterState";
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

describe("buildBrowseRows", () => {
  it("returns every course with null eligibility when no completed courses are given", () => {
    const courses = [
      makeCourse({ code: "math116", prereqs: "MATH 115" }),
      makeCourse({ id: 2, code: "phil110", prereqs: null }),
    ];
    const rows = buildBrowseRows(courses, DEFAULT_PURE_FILTERS, []);
    expect(rows.map((r) => r.course.code)).toEqual(["math116", "phil110"]);
    expect(rows.every((r) => r.eligibility === null)).toBe(true);
  });

  it("computes eligibility when completed courses are supplied", () => {
    const courses = [
      makeCourse({ id: 1, code: "cs136", prereqs: "CS 115" }),
      makeCourse({ id: 2, code: "cs486", prereqs: "CS 341" }),
    ];
    const rows = buildBrowseRows(courses, DEFAULT_PURE_FILTERS, ["cs115"]);
    expect(rows[0].eligibility?.satisfied).toBe(true);
    expect(rows[1].eligibility?.satisfied).toBe(false);
    expect(rows[1].eligibility?.missingCourses).toEqual(["cs341"]);
  });

  it("hideUnmetPrereqs drops only rows with definite unmet prereqs", () => {
    const courses = [
      makeCourse({ id: 1, code: "cs136", prereqs: "CS 115" }),
      makeCourse({ id: 2, code: "cs486", prereqs: "CS 341" }),
    ];
    const rows = buildBrowseRows(
      courses,
      { ...DEFAULT_PURE_FILTERS, hideUnmetPrereqs: true },
      ["cs115"],
    );
    expect(rows.map((r) => r.course.code)).toEqual(["cs136"]);
  });

  it("hideUnmetPrereqs with no completed courses leaves every row in (no eligibility computed)", () => {
    const courses = [
      makeCourse({ id: 1, code: "cs136", prereqs: "CS 115" }),
      makeCourse({ id: 2, code: "cs486", prereqs: "CS 341" }),
    ];
    const rows = buildBrowseRows(
      courses,
      { ...DEFAULT_PURE_FILTERS, hideUnmetPrereqs: true },
      [],
    );
    expect(rows.map((r) => r.course.code)).toEqual(["cs136", "cs486"]);
    expect(rows.every((r) => r.eligibility === null)).toBe(true);
  });

  it("uncertain prereqs (raw text only) survive hideUnmetPrereqs", () => {
    const courses = [
      makeCourse({
        id: 1,
        code: "phil110",
        prereqs: "Permission of the instructor",
      }),
    ];
    const rows = buildBrowseRows(
      courses,
      { ...DEFAULT_PURE_FILTERS, hideUnmetPrereqs: true },
      ["cs115"],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].eligibility?.uncertain).toBe(true);
  });

  it("applies pure-filter predicates before eligibility", () => {
    const courses = [
      makeCourse({ id: 1, code: "math116" }),
      makeCourse({ id: 2, code: "phil110" }),
    ];
    const rows = buildBrowseRows(
      courses,
      { ...DEFAULT_PURE_FILTERS, excludePrefixes: ["PHIL"] },
      [],
    );
    expect(rows.map((r) => r.course.code)).toEqual(["math116"]);
  });
});

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
