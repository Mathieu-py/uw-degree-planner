import { describe, expect, it } from "vitest";
import {
  applyTranscriptToStudentPassage,
  buildImportPayload,
  type Categorized,
  categorize,
  type TranscriptImportPayload,
} from "../transcript/applyHelpers";
import type { ParsedCourse, TranscriptParseResult } from "../transcript/types";

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

describe("buildImportPayload", () => {
  it("includes passed + in-progress + transfer codes; omits skipped", () => {
    const c: Categorized = {
      passed: [course("cs135", "passed")],
      inProgress: [course("cs136", "inProgress")],
      transfer: [course("math137", "transfer")],
      skipped: [course("cs999", "skipped")],
      unrecognized: [],
    };
    const payload = buildImportPayload(result([]), c, new Set());
    expect(payload.codes).toEqual(["cs135", "cs136", "math137"]);
  });

  it("omits unrecognized codes that are not in includedUnrecognized", () => {
    const c: Categorized = {
      passed: [course("cs135", "passed")],
      inProgress: [],
      transfer: [],
      skipped: [],
      unrecognized: [course("zzz999", "unrecognized")],
    };
    const payload = buildImportPayload(result([]), c, new Set());
    expect(payload.codes).toEqual(["cs135"]);
  });

  it("includes unrecognized codes that ARE in includedUnrecognized", () => {
    const c: Categorized = {
      passed: [course("cs135", "passed")],
      inProgress: [],
      transfer: [],
      skipped: [],
      unrecognized: [
        course("zzz999", "unrecognized"),
        course("yyy888", "unrecognized"),
      ],
    };
    const payload = buildImportPayload(result([]), c, new Set(["zzz999"]));
    expect(payload.codes).toEqual(["cs135", "zzz999"]);
  });

  it("returns codes sorted and deduped", () => {
    const c: Categorized = {
      passed: [course("math137", "passed"), course("cs135", "passed")],
      inProgress: [course("cs135", "inProgress")], // dup of passed
      transfer: [course("math137", "transfer")], // dup of passed
      skipped: [],
      unrecognized: [],
    };
    const payload = buildImportPayload(result([]), c, new Set());
    expect(payload.codes).toEqual(["cs135", "math137"]);
  });

  it("forwards detectedProgramId and detectedCurrentTerm from the parse result", () => {
    const r = result([], {
      detectedProgramId: "systems-design-engineering",
      detectedCurrentTerm: "3A",
    });
    const empty: Categorized = {
      passed: [],
      inProgress: [],
      transfer: [],
      skipped: [],
      unrecognized: [],
    };
    const payload = buildImportPayload(r, empty, new Set());
    expect(payload.programId).toBe("systems-design-engineering");
    expect(payload.currentTerm).toBe("3A");
  });
});

describe("applyTranscriptToStudentPassage", () => {
  const payload: TranscriptImportPayload = {
    codes: ["cs135", "math137"],
    programId: "electrical-engineering",
    currentTerm: "2A",
  };

  it("returns a passage with exactly the payload's fields", () => {
    const next = applyTranscriptToStudentPassage(payload);
    expect(next).toEqual({
      programId: "electrical-engineering",
      currentTerm: "2A",
      completedCourses: ["cs135", "math137"],
    });
  });

  it("returns exactly the StudentPassage shape (no extra keys leak)", () => {
    const next = applyTranscriptToStudentPassage(payload);
    expect(Object.keys(next).sort()).toEqual([
      "completedCourses",
      "currentTerm",
      "programId",
    ]);
  });

  it("handles null programId/currentTerm in the payload (no program detected)", () => {
    const next = applyTranscriptToStudentPassage({
      codes: ["cs135"],
      programId: null,
      currentTerm: null,
    });
    expect(next.programId).toBeNull();
    expect(next.currentTerm).toBeNull();
    expect(next.completedCourses).toEqual(["cs135"]);
  });
});
