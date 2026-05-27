import { describe, expect, it } from "vitest";
import { type Categorized, categorize } from "../parse";
import type { ParsedCourse, TranscriptParseResult } from "../types";

function course(
  code: string,
  status: ParsedCourse["status"],
  overrides: Partial<ParsedCourse> = {},
): ParsedCourse {
  return {
    code,
    name: `Course ${code}`,
    termLabel: "Fall 2023",
    status,
    rawGrade: status === "passed" ? "80" : "",
    ...overrides,
  };
}

function result(
  courses: ParsedCourse[],
  overrides: Partial<TranscriptParseResult> = {},
): TranscriptParseResult {
  return {
    detectedProgramId: null,
    detectedSpecializationSlug: null,
    detectedCurrentTerm: null,
    detectedSystemOfStudy: null,
    rawPlanText: null,
    courses,
    warnings: [],
    ...overrides,
  };
}

describe("categorize", () => {
  it("buckets each status into its corresponding array", () => {
    const r = result([
      course("cs135", "passed"),
      course("cs136", "inProgress"),
      course("math137", "transfer"),
      course("cs999", "skipped"),
      course("xyz000", "unrecognized"),
    ]);
    const catalog = new Set(["cs135", "cs136", "math137"]);
    const out = categorize(r, catalog);
    expect(out.passed.map((c) => c.code)).toEqual(["cs135"]);
    expect(out.inProgress.map((c) => c.code)).toEqual(["cs136"]);
    expect(out.transfer.map((c) => c.code)).toEqual(["math137"]);
    expect(out.skipped.map((c) => c.code)).toEqual(["cs999"]);
    expect(out.unrecognized.map((c) => c.code)).toEqual(["xyz000"]);
  });

  it("demotes a course with a real status to 'unrecognized' if its code is not in the catalog", () => {
    // A SYDE student paste includes "SYDE 999" (passed) but the catalog
    // doesn't have SYDE 999 (it's old / been renamed). We need to surface it
    // so the user decides — don't quietly drop it into completedCourses.
    const r = result([course("syde999", "passed")]);
    const out = categorize(r, new Set(["syde101"]));
    expect(out.passed).toEqual([]);
    expect(out.unrecognized.map((c) => c.code)).toEqual(["syde999"]);
  });

  it("returns five empty arrays for an empty parse result", () => {
    const out = categorize(result([]), new Set());
    const expected: Categorized = {
      passed: [],
      inProgress: [],
      transfer: [],
      skipped: [],
      unrecognized: [],
    };
    expect(out).toEqual(expected);
  });
});
