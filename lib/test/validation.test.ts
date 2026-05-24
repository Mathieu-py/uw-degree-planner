import { describe, expect, it } from "vitest";
import { CoursesFileError, validateCoursesFile } from "../validation";

function validCourse(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    code: "cs115",
    name: "Intro CS",
    description: null,
    prereqs: null,
    coreqs: null,
    antireqs: null,
    rating: null,
    sections: [],
    ...overrides,
  };
}

function validFile(overrides: Record<string, unknown> = {}) {
  return {
    termId: 1261,
    fetchedAt: "2026-05-14T00:00:00Z",
    courseCount: 1,
    courses: [validCourse()],
    ...overrides,
  };
}

describe("validateCoursesFile", () => {
  it("accepts a minimal valid file", () => {
    expect(() => validateCoursesFile(validFile())).not.toThrow();
  });

  it("rejects a non-object root", () => {
    expect(() => validateCoursesFile(null)).toThrow(CoursesFileError);
    expect(() => validateCoursesFile([])).toThrow(CoursesFileError);
    expect(() => validateCoursesFile("nope")).toThrow(CoursesFileError);
  });

  it("rejects a missing termId", () => {
    const f = validFile();
    delete (f as Record<string, unknown>).termId;
    expect(() => validateCoursesFile(f)).toThrow(/termId/);
  });

  it("rejects a non-array courses field", () => {
    expect(() => validateCoursesFile(validFile({ courses: "nope" }))).toThrow(
      /courses/,
    );
  });

  it("rejects a course missing code", () => {
    const c = validCourse();
    delete (c as Record<string, unknown>).code;
    expect(() => validateCoursesFile(validFile({ courses: [c] }))).toThrow(
      /code/,
    );
  });

  it("rejects a course with empty code", () => {
    expect(() =>
      validateCoursesFile(validFile({ courses: [validCourse({ code: "" })] })),
    ).toThrow(/code/);
  });

  it("rejects a course missing id", () => {
    const c = validCourse();
    delete (c as Record<string, unknown>).id;
    expect(() => validateCoursesFile(validFile({ courses: [c] }))).toThrow(
      /id/,
    );
  });

  it("rejects a non-string description", () => {
    expect(() =>
      validateCoursesFile(
        validFile({ courses: [validCourse({ description: 42 })] }),
      ),
    ).toThrow(/description/);
  });

  it("rejects a section missing enrollment_capacity", () => {
    const c = validCourse({
      sections: [{ id: 1, enrollment_total: 0 }],
    });
    expect(() => validateCoursesFile(validFile({ courses: [c] }))).toThrow(
      /enrollment_capacity/,
    );
  });

  it("rejects a rating with a non-numeric useful field", () => {
    const c = validCourse({
      rating: { easy: 0.5, useful: "high", liked: 0.5, filled_count: 10 },
    });
    expect(() => validateCoursesFile(validFile({ courses: [c] }))).toThrow(
      /useful/,
    );
  });

  it("includes the field path in the error message", () => {
    const c = validCourse({ name: 42 });
    expect(() => validateCoursesFile(validFile({ courses: [c] }))).toThrow(
      /courses\.0\.name/,
    );
  });
});
