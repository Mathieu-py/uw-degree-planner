import { describe, expect, it } from "vitest";
import type { Course } from "../../types";
import type { LocalPlan } from "../types";
import {
  ACADEMIC_TERM_CAP,
  extractCourseCodes,
  issuesByCourseInSlot,
  validatePlan,
} from "../validate";

function mkCourse(
  code: string,
  opts: { prereqs?: string; coreqs?: string; antireqs?: string } = {},
): Course {
  return {
    id: 0,
    code,
    name: code,
    description: null,
    prereqs: opts.prereqs ?? null,
    coreqs: opts.coreqs ?? null,
    antireqs: opts.antireqs ?? null,
    rating: null,
    sections: [],
    prefix: code.replace(/\d.*$/, "").toUpperCase(),
    level: 100,
    hasSeats: false,
  };
}

function catalog(...courses: Course[]): Map<string, Course> {
  return new Map(courses.map((c) => [c.code, c]));
}

function mkPlan(
  slots: Array<{
    id: string;
    termId: number | null;
    isCoop?: boolean;
    position?: string;
    courses: string[];
  }>,
): LocalPlan {
  return {
    version: 1,
    programId: null,
    specializationId: null,
    stream: "stream8",
    startTermId: 1239,
    slots: slots.map((s) => ({
      id: s.id,
      termId: s.termId,
      // biome-ignore lint/suspicious/noExplicitAny: test fixtures use freeform positions
      position: (s.position ?? (s.isCoop ? "coop1" : "1A")) as any,
      isCoop: s.isCoop ?? false,
      courses: s.courses.map((c) => ({ code: c })),
    })),
    updatedAt: "2026-05-23T12:00:00.000Z",
  };
}

describe("extractCourseCodes", () => {
  it("pulls codes from comma-separated lists", () => {
    expect(extractCourseCodes("ANTH 201, CLAS 221")).toEqual([
      "anth201",
      "clas221",
    ]);
  });
  it("handles codes with trailing letters", () => {
    expect(extractCourseCodes("CS 246A or SYDE 101L")).toEqual([
      "cs246a",
      "syde101l",
    ]);
  });
  it("deduplicates", () => {
    expect(extractCourseCodes("MATH 137; MATH 137")).toEqual(["math137"]);
  });
  it("ignores non-code prose", () => {
    expect(extractCourseCodes("Permission of instructor")).toEqual([]);
  });
});

describe("validatePlan — prereq", () => {
  it("flags a course whose prereq is not in the plan", () => {
    const cat = catalog(
      mkCourse("cs246", { prereqs: "CS 136" }),
      mkCourse("cs136"),
    );
    const plan = mkPlan([
      { id: "s1", termId: 1239, courses: ["cs246"] }, // missing cs136
    ]);
    const issues = validatePlan(plan, cat);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("prereq");
    expect(issues[0].courseCode).toBe("cs246");
    expect(issues[0].message).toContain("cs136");
  });

  it("does not flag when prereq is placed in an earlier slot", () => {
    const cat = catalog(
      mkCourse("cs246", { prereqs: "CS 136" }),
      mkCourse("cs136"),
    );
    const plan = mkPlan([
      { id: "s1", termId: 1239, courses: ["cs136"] },
      { id: "s2", termId: 1241, courses: ["cs246"] },
    ]);
    expect(validatePlan(plan, cat)).toEqual([]);
  });

  it("DOES flag when prereq is placed in the SAME slot (prereqs must be earlier)", () => {
    const cat = catalog(
      mkCourse("cs246", { prereqs: "CS 136" }),
      mkCourse("cs136"),
    );
    const plan = mkPlan([
      { id: "s1", termId: 1239, courses: ["cs136", "cs246"] },
    ]);
    const issues = validatePlan(plan, cat);
    expect(issues.map((i) => i.kind)).toEqual(["prereq"]);
  });
});

describe("validatePlan — antireq", () => {
  it("flags a course whose antireq is placed anywhere in the plan", () => {
    const cat = catalog(
      mkCourse("math115", { antireqs: "MATH 117" }),
      mkCourse("math117", { antireqs: "MATH 115" }),
    );
    const plan = mkPlan([
      { id: "s1", termId: 1239, courses: ["math115"] },
      { id: "s2", termId: 1241, courses: ["math117"] },
    ]);
    const issues = validatePlan(plan, cat);
    expect(issues.map((i) => i.kind)).toEqual(["antireq", "antireq"]);
    const m115 = issues.find((i) => i.courseCode === "math115");
    expect(m115?.message).toContain("math117");
  });

  it("does not flag a course's antireq list against itself", () => {
    const cat = catalog(
      mkCourse("cs115", { antireqs: "CS 115 (?)" }), // self-reference (malformed; should not flag)
    );
    const plan = mkPlan([{ id: "s1", termId: 1239, courses: ["cs115"] }]);
    expect(validatePlan(plan, cat)).toEqual([]);
  });
});

describe("validatePlan — coreq", () => {
  it("does not flag a coreq satisfied by same-slot placement", () => {
    const cat = catalog(
      mkCourse("syde101", { coreqs: "SYDE 101L" }),
      mkCourse("syde101l"),
    );
    const plan = mkPlan([
      { id: "s1", termId: 1239, courses: ["syde101", "syde101l"] },
    ]);
    expect(validatePlan(plan, cat)).toEqual([]);
  });

  it("does not flag a coreq satisfied by a previous slot", () => {
    const cat = catalog(
      mkCourse("syde101", { coreqs: "SYDE 101L" }),
      mkCourse("syde101l"),
    );
    const plan = mkPlan([
      { id: "s1", termId: 1239, courses: ["syde101l"] },
      { id: "s2", termId: 1241, courses: ["syde101"] },
    ]);
    expect(validatePlan(plan, cat)).toEqual([]);
  });

  it("flags a missing coreq", () => {
    const cat = catalog(
      mkCourse("syde101", { coreqs: "SYDE 101L" }),
      mkCourse("syde101l"),
    );
    const plan = mkPlan([{ id: "s1", termId: 1239, courses: ["syde101"] }]);
    const issues = validatePlan(plan, cat);
    expect(issues.map((i) => i.kind)).toEqual(["coreq"]);
  });
});

describe("validatePlan — overload", () => {
  it("flags an academic slot over the cap", () => {
    const cat = catalog(
      mkCourse("a"),
      mkCourse("b"),
      mkCourse("c"),
      mkCourse("d"),
      mkCourse("e"),
      mkCourse("f"),
      mkCourse("g"),
    );
    const plan = mkPlan([
      {
        id: "s1",
        termId: 1239,
        courses: ["a", "b", "c", "d", "e", "f", "g"],
      },
    ]);
    const issues = validatePlan(plan, cat);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("overload");
    expect(issues[0].slotId).toBe("s1");
    expect(issues[0].message).toContain(`cap ${ACADEMIC_TERM_CAP}`);
  });

  it("does not flag a slot at the cap", () => {
    const cat = catalog(
      mkCourse("a"),
      mkCourse("b"),
      mkCourse("c"),
      mkCourse("d"),
      mkCourse("e"),
      mkCourse("f"),
    );
    const plan = mkPlan([
      {
        id: "s1",
        termId: 1239,
        courses: ["a", "b", "c", "d", "e", "f"],
      },
    ]);
    expect(validatePlan(plan, cat)).toEqual([]);
  });
});

describe("validatePlan — co-op slots", () => {
  it("skips co-op slots entirely", () => {
    const cat = catalog(mkCourse("cs246", { prereqs: "CS 136" }));
    const plan = mkPlan([
      { id: "s1", termId: 1245, isCoop: true, courses: ["cs246"] },
    ]);
    expect(validatePlan(plan, cat)).toEqual([]);
  });
});

describe("issuesByCourseInSlot", () => {
  it("partitions per-course issues from slot-level issues", () => {
    const slotIssues = [
      {
        slotId: "s1",
        courseCode: "cs246",
        kind: "prereq" as const,
        message: "x",
      },
      { slotId: "s1", courseCode: "", kind: "overload" as const, message: "y" },
      {
        slotId: "s1",
        courseCode: "cs246",
        kind: "antireq" as const,
        message: "z",
      },
    ];
    const { byCourse, slotLevel } = issuesByCourseInSlot(slotIssues);
    expect(byCourse.get("cs246")?.map((i) => i.kind)).toEqual([
      "prereq",
      "antireq",
    ]);
    expect(slotLevel.map((i) => i.kind)).toEqual(["overload"]);
  });
});
