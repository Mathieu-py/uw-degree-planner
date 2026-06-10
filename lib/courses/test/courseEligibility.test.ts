import { describe, expect, it } from "vitest";
import type { ProgramIdentity } from "@/lib/programs";
import {
  type CourseEligibilityContext,
  evaluateCourseEligibility,
} from "../courseEligibility";
import { enrichCourse } from "../filters";
import type { Course, UWFlowCourse } from "../types";

const SYDE: ProgramIdentity = {
  programId: "systems-design-engineering",
  names: ["systems design engineering", "syde"],
  faculty: "engineering",
};

function course(over: Partial<UWFlowCourse> = {}): Course {
  const base: UWFlowCourse = {
    id: 1,
    code: "test100",
    name: "Test",
    description: null,
    prereqs: null,
    coreqs: null,
    antireqs: null,
    rating: null,
    sections: [],
  };
  return enrichCourse({ ...base, ...over });
}

function ctx(
  over: Partial<CourseEligibilityContext> = {},
): CourseEligibilityContext {
  return {
    completed: new Set(),
    programReferenced: new Set(),
    placedAnywhere: new Set(),
    ...over,
  };
}

describe("evaluateCourseEligibility", () => {
  it("is eligible when the course has no constraints", () => {
    expect(evaluateCourseEligibility(course(), ctx()).state).toBe("eligible");
  });

  it("is ineligible (duplicate) when the course is already placed", () => {
    const v = evaluateCourseEligibility(
      course({ code: "cs246" }),
      ctx({ placedAnywhere: new Set(["cs246"]) }),
    );
    expect(v.state).toBe("ineligible");
    expect(v.alreadyPlaced).toBe(true);
  });

  it("is ineligible everywhere when an antireq is already placed", () => {
    const v = evaluateCourseEligibility(
      course({ code: "math119", antireqs: "MATH138" }),
      ctx({ placedAnywhere: new Set(["math138"]) }),
    );
    expect(v.state).toBe("ineligible");
    expect(v.antireqConflicts).toContain("MATH 138");
  });

  it("still blocks an antireq even with an empty completed set", () => {
    const v = evaluateCourseEligibility(
      course({ code: "math119", antireqs: "MATH138" }),
      ctx({ completed: new Set(), placedAnywhere: new Set(["math138"]) }),
    );
    expect(v.state).toBe("ineligible");
  });

  it("blocks a foreign program-restricted course the program does NOT reference", () => {
    const v = evaluateCourseEligibility(
      course({ code: "anth101", prereqs: "Anthropology students only" }),
      ctx({ completed: new Set(["cs135"]), program: SYDE }),
    );
    expect(v.state).toBe("ineligible");
    expect(v.blockedByProgram).toBe(true);
  });

  it("a level-gate failure is ineligible but NOT blockedByProgram", () => {
    // Prereq met, but the term's level is too low — distinct from a program
    // restriction, so the picker labels it "Missing prereqs", not "Wrong program".
    const v = evaluateCourseEligibility(
      course({ code: "cs341", prereqs: "CS246 and Level at least 3A" }),
      ctx({ completed: new Set(["cs246"]), level: "2A" }),
    );
    expect(v.state).toBe("ineligible");
    expect(v.blockedByProgram).toBe(false);
    expect(v.missingCourses).toHaveLength(0);
  });

  it("does NOT block a program-restricted course the program references (required-aware)", () => {
    const c = course({
      code: "math119",
      prereqs:
        "One of MATH116, MATH117; Open only to students in Software Engineering",
    });
    // SYDE isn't named in the restriction, but the program references MATH119
    // and a prereq is met → never ineligible (the program clause is demoted).
    const referenced = evaluateCourseEligibility(
      c,
      ctx({
        completed: new Set(["math117"]),
        level: "2A",
        program: SYDE,
        programReferenced: new Set(["math119"]),
      }),
    );
    expect(referenced.state).not.toBe("ineligible");
    // Same course, NOT referenced → the restriction blocks it.
    const notReferenced = evaluateCourseEligibility(
      c,
      ctx({
        completed: new Set(["math117"]),
        level: "2A",
        program: SYDE,
      }),
    );
    expect(notReferenced.state).toBe("ineligible");
  });

  it("marks an unmet coreq as check, not ineligible", () => {
    const v = evaluateCourseEligibility(
      course({ code: "phys121", coreqs: "MATH117" }),
      ctx({ completed: new Set(["cs135"]) }),
    );
    expect(v.state).toBe("check");
  });

  it("treats a coreq satisfied in the same term as eligible", () => {
    const v = evaluateCourseEligibility(
      course({ code: "phys121", coreqs: "MATH117" }),
      ctx({ completed: new Set(["cs135"]), sameTerm: new Set(["math117"]) }),
    );
    expect(v.state).toBe("eligible");
  });
});
