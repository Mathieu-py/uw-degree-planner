import { describe, expect, it } from "vitest";
import type { ProgramIdentity } from "@/lib/programs";
import {
  type CourseEligibilityContext,
  evaluateCourseEligibility,
  isProgramBlocked,
  placedAntireqNamers,
} from "../courseEligibility";
import { enrichCourse } from "../filters";
import type { Course, UWFlowCourse } from "../types";

const SYDE: ProgramIdentity = {
  programId: "systems-design-engineering",
  names: ["systems design engineering", "syde"],
  faculty: "engineering",
};
const CS: ProgramIdentity = {
  programId: "h-computer-science-bcs",
  names: ["computer science", "cs"],
  faculty: "mathematics",
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

  it("flags a candidate when a placed course names it (reverse antireq)", () => {
    // ECE 150 doesn't list CS 115, but placed CS 115 lists ECE 150 — the credit
    // rule bars both, so adding ECE 150 must conflict.
    const cs115 = course({ code: "cs115", antireqs: "ECE150" });
    const v = evaluateCourseEligibility(
      course({ code: "ece150", antireqs: "CIVE121" }),
      ctx({
        placedAnywhere: new Set(["cs115"]),
        placedAntireqNamers: placedAntireqNamers([cs115]),
      }),
    );
    expect(v.state).toBe("ineligible");
    expect(v.antireqConflicts).toContain("CS 115");
  });

  it("blocks a foreign program-restricted course the program does NOT reference", () => {
    const v = evaluateCourseEligibility(
      course({ code: "anth101", prereqs: "Anthropology students only" }),
      ctx({ completed: new Set(["cs135"]), programs: [SYDE] }),
    );
    expect(v.state).toBe("ineligible");
    expect(v.blockedByProgram).toBe(true);
  });

  it("names both an OR'd course and level alternative in the reason", () => {
    // "CS 135 or level ≥ 3A" at level 2A with CS 135 not taken: ineligible, and
    // the reason must mention both open routes, not just the level gate.
    const v = evaluateCourseEligibility(
      course({ code: "cs246", prereqs: "CS135 or level at least 3A" }),
      ctx({ level: "2A" }),
    );
    expect(v.state).toBe("ineligible");
    const reason = v.reasons.join(" ");
    expect(reason).toMatch(/CS\s*135/i);
    expect(reason).toMatch(/level at least 3A/i);
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
        programs: [SYDE],
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
        programs: [SYDE],
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

  it("blocks a 'Not open to Faculty of Math students' course for a Math student", () => {
    // CS 114's real restriction. A Math-faculty student is excluded.
    const v = evaluateCourseEligibility(
      course({
        code: "cs114",
        prereqs: "Not open to Faculty of Math students.",
      }),
      ctx({ programs: [CS] }),
    );
    expect(v.state).toBe("ineligible");
    expect(v.blockedByProgram).toBe(true);
  });

  it("allows the same course for a non-excluded faculty", () => {
    const v = evaluateCourseEligibility(
      course({
        code: "cs114",
        prereqs: "Not open to Faculty of Math students.",
      }),
      ctx({ programs: [SYDE] }),
    );
    expect(v.blockedByProgram).toBe(false);
    expect(v.state).not.toBe("ineligible");
  });

  it("ranks a program/faculty block above an antireq conflict", () => {
    // CS 114 is both closed to Math students AND an antireq of placed CS 136.
    // "Wrong program" (a hard block) must win over the antireq chip.
    const v = evaluateCourseEligibility(
      course({
        code: "cs114",
        prereqs: "Not open to Faculty of Math students.",
        antireqs: "CS136",
      }),
      ctx({ programs: [CS], placedAnywhere: new Set(["cs136"]) }),
    );
    expect(v.state).toBe("ineligible");
    expect(v.blockedByProgram).toBe(true);
    expect(v.antireqConflicts).toHaveLength(0);
  });

  it("surfaces the restriction (not a missing-course hint) when a block also has an unmet prereq", () => {
    // Closed to the student's faculty AND missing ANTH 201. The block outranks,
    // so the reason must read as the restriction, not "Needs ANTH 201".
    const v = evaluateCourseEligibility(
      course({
        code: "anth301",
        prereqs: "ANTH 201 and Anthropology students only",
      }),
      ctx({ programs: [SYDE] }),
    );
    expect(v.state).toBe("ineligible");
    expect(v.blockedByProgram).toBe(true);
    expect(v.reasons.some((r) => /anthropolog/i.test(r))).toBe(true);
    expect(v.reasons.some((r) => /needs/i.test(r))).toBe(false);
  });
});

describe("isProgramBlocked", () => {
  const cs114 = course({
    code: "cs114",
    prereqs: "Not open to Faculty of Math students.",
  });

  it("is true for a faculty the course is closed to", () => {
    expect(isProgramBlocked(cs114, { programs: [CS] })).toBe(true);
  });

  it("is false for a faculty the course is open to", () => {
    expect(isProgramBlocked(cs114, { programs: [SYDE] })).toBe(false);
  });

  it("is false when the student's program references the course (suppressed)", () => {
    expect(
      isProgramBlocked(cs114, {
        programs: [CS],
        programReferenced: new Set(["cs114"]),
      }),
    ).toBe(false);
  });

  it("is false for a course with no program restriction", () => {
    expect(
      isProgramBlocked(course({ code: "cs246", prereqs: "CS136" }), {
        programs: [CS],
      }),
    ).toBe(false);
  });

  it("is false when a course alternative could satisfy the restriction (OR)", () => {
    // "CS 135 OR Anthropology students only" — a non-Anthropology student can
    // qualify by taking CS 135, so it's not an unconditional program wall.
    const c = course({
      code: "anth150",
      prereqs: "CS 135 or Anthropology students only",
    });
    expect(isProgramBlocked(c, { programs: [SYDE] })).toBe(false);
  });

  it("is true when the restriction is unconditional alongside a course (AND)", () => {
    // "CS 135 AND Anthropology students only" — no course lets a non-
    // Anthropology student in, so the program wall stands.
    const c = course({
      code: "anth250",
      prereqs: "CS 135 and Anthropology students only",
    });
    expect(isProgramBlocked(c, { programs: [SYDE] })).toBe(true);
  });
});
