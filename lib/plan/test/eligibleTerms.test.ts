import { describe, expect, it } from "vitest";
import { enrichCourse } from "@/lib/courses/filters";
import type { BaseCourse, Course } from "@/lib/courses/types";
import type { ProgramIdentity } from "@/lib/programs";
import { eligibleSlotIdsForCourse } from "../eligibleTerms";
import type { LocalPlan } from "../types";

const SYDE: ProgramIdentity = {
  programId: "systems-design-engineering",
  names: ["systems design engineering", "syde"],
  faculty: "engineering",
};

function makeCourse(
  code: string,
  prereqs: string | null,
  antireqs: string | null = null,
): Course {
  const base: BaseCourse = {
    id: 1,
    code,
    name: code.toUpperCase(),
    description: null,
    prereqs,
    coreqs: null,
    antireqs,
    rating: null,
    sections: [],
  };
  return enrichCourse(base);
}

function catalog(...courses: Course[]): Map<string, Course> {
  return new Map(courses.map((c) => [c.code, c]));
}

// pre + four academic terms (1A 1B 2A 2B) with a co-op work term interleaved.
const PLAN: LocalPlan = {
  schemaVersion: 3,
  programIds: ["systems-design-engineering"],
  specializationIds: {},
  stream: "stream8",
  startTermId: 1239,
  slots: [
    {
      id: "pre",
      termId: null,
      position: "pre",
      isCoop: false,
      courses: [{ code: "transfer1" }],
    },
    {
      id: "s1a",
      termId: 1239,
      position: "1A",
      isCoop: false,
      courses: [{ code: "cs135" }],
    },
    {
      id: "s1b",
      termId: 1241,
      position: "1B",
      isCoop: false,
      courses: [{ code: "cs136" }],
    },
    {
      id: "coop1",
      termId: 1245,
      position: "coop1",
      isCoop: true,
      courses: [],
    },
    {
      id: "s2a",
      termId: 1249,
      position: "2A",
      isCoop: false,
      courses: [],
    },
    {
      id: "s2b",
      termId: 1251,
      position: "2B",
      isCoop: false,
      courses: [],
    },
  ],
  updatedAt: "2026-06-01T00:00:00.000Z",
};

const ACADEMIC = ["s1a", "s1b", "s2a", "s2b"];

describe("eligibleSlotIdsForCourse", () => {
  it("includes every academic slot — and never co-op or pre-arrival — for a course with no prereqs", () => {
    const result = eligibleSlotIdsForCourse(
      PLAN,
      "free100",
      catalog(makeCourse("free100", null)),
    );
    expect([...result].sort()).toEqual([...ACADEMIC].sort());
    expect(result.has("coop1")).toBe(false);
    expect(result.has("pre")).toBe(false);
  });

  it("treats an unknown (uncatalogued) course as having no prereqs", () => {
    const result = eligibleSlotIdsForCourse(PLAN, "ghost999", catalog());
    expect([...result].sort()).toEqual([...ACADEMIC].sort());
  });

  it("only includes terms strictly after a course prereq is satisfied", () => {
    // Needs cs136 (placed in 1B / termId 1241). "Completed before this term"
    // means cs136 counts from 2A onward — not in 1A or 1B itself.
    const result = eligibleSlotIdsForCourse(
      PLAN,
      "cs241",
      catalog(makeCourse("cs241", "CS136")),
    );
    expect(result.has("s1a")).toBe(false);
    expect(result.has("s1b")).toBe(false);
    expect(result.has("s2a")).toBe(true);
    expect(result.has("s2b")).toBe(true);
  });

  it("resolves a level gate per term using the slot's position", () => {
    const result = eligibleSlotIdsForCourse(
      PLAN,
      "cs246",
      catalog(makeCourse("cs246", "Level at least 2A")),
    );
    expect(result.has("s1a")).toBe(false);
    expect(result.has("s1b")).toBe(false);
    expect(result.has("s2a")).toBe(true);
    expect(result.has("s2b")).toBe(true);
  });

  it("excludes every term for a course reserved to another program", () => {
    const result = eligibleSlotIdsForCourse(
      PLAN,
      "anth101",
      catalog(makeCourse("anth101", "Anthropology students only")),
      [SYDE],
    );
    expect(result.size).toBe(0);
  });

  it("treats an unparseable (uncertain) prereq as eligible everywhere", () => {
    const result = eligibleSlotIdsForCourse(
      PLAN,
      "msci261",
      catalog(makeCourse("msci261", "Consent of the department")),
      [SYDE],
    );
    expect([...result].sort()).toEqual([...ACADEMIC].sort());
  });

  it("does not grey a program-restricted course the program references (required-aware)", () => {
    const cat = catalog(
      makeCourse("math119", "Open only to students in Software Engineering"),
    );
    // Not referenced → a wrong-program block greys every term.
    expect(eligibleSlotIdsForCourse(PLAN, "math119", cat, [SYDE]).size).toBe(0);
    // Referenced → no longer greyed (the restriction is demoted to a check).
    const referenced = eligibleSlotIdsForCourse(
      PLAN,
      "math119",
      cat,
      [SYDE],
      new Set(["math119"]),
    );
    expect([...referenced].sort()).toEqual([...ACADEMIC].sort());
  });

  it("greys every term when an antireq is already in the plan", () => {
    // cs135 is placed in 1A; a course that antireqs it can't go anywhere.
    const result = eligibleSlotIdsForCourse(
      PLAN,
      "math119",
      catalog(makeCourse("math119", null, "CS135")),
    );
    expect(result.size).toBe(0);
  });
});
