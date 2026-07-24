import { describe, expect, it } from "vitest";
import type { CoursesFile } from "../../lib/courses/validation";
import {
  assessChangedFiles,
  assessCourseSnapshot,
  DEFAULT_THRESHOLDS,
} from "../guard-snapshot";

// Minimal CoursesFile: the assessor only reads `courses[].sections.length`.
function mkFile(count: number, withSeating: number): CoursesFile {
  const courses = Array.from({ length: count }, (_, i) => ({
    code: `c${i}`,
    sections:
      i < withSeating
        ? [{ id: i, enrollment_total: 0, enrollment_capacity: 1 }]
        : [],
  }));
  return {
    termId: 1269,
    fetchedAt: "",
    courseCount: count,
    courses,
  } as CoursesFile;
}

describe("assessChangedFiles", () => {
  it("allows courses / descriptions / programs snapshot files", () => {
    expect(
      assessChangedFiles([
        "data/courses.1269.json",
        "data/descriptions.1269.json",
        "data/programs.json",
      ]),
    ).toEqual([]);
  });

  it("flags any file outside the refresh allowlist", () => {
    const v = assessChangedFiles([
      "data/courses.1269.json",
      "lib/log.ts",
      "data/programs-index.json",
    ]);
    expect(v).toHaveLength(2);
    expect(v.join(" ")).toContain("lib/log.ts");
    expect(v.join(" ")).toContain("programs-index.json");
  });
});

describe("assessCourseSnapshot", () => {
  const t = DEFAULT_THRESHOLDS;

  it("passes on normal drift", () => {
    expect(
      assessCourseSnapshot(mkFile(1000, 500), mkFile(995, 480), t),
    ).toEqual([]);
  });

  it("passes for a brand-new term (no predecessor)", () => {
    expect(assessCourseSnapshot(null, mkFile(1000, 500), t)).toEqual([]);
  });

  it("refuses an empty snapshot", () => {
    const v = assessCourseSnapshot(mkFile(1000, 500), mkFile(0, 0), t);
    expect(v.join(" ")).toContain("empty");
  });

  it("flags a mass course-count drop", () => {
    const v = assessCourseSnapshot(mkFile(1000, 500), mkFile(800, 400), t);
    expect(v.join(" ")).toContain("course count dropped");
  });

  it("flags a seating wipe even when course count holds", () => {
    const v = assessCourseSnapshot(mkFile(1000, 500), mkFile(1000, 100), t);
    expect(v.join(" ")).toContain("courses with seating dropped");
  });

  it("does not flag a small seating dip within threshold", () => {
    expect(
      assessCourseSnapshot(mkFile(1000, 500), mkFile(1000, 460), t),
    ).toEqual([]);
  });
});
