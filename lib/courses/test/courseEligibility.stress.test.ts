import { describe, expect, it } from "vitest";
import type { ProgramIdentity } from "@/lib/programs";
import {
  type CourseEligibilityContext,
  evaluateCourseEligibility,
  isProgramBlocked,
  placedAntireqNamers,
} from "../courseEligibility";
import { enrichCourse } from "../filters";
import type { BaseCourse, Course } from "../types";

/**
 * Stress tests for course eligibility, anchored to verbatim antireq/restriction
 * prose from the catalog snapshot (data/courses.1261.json) and the UW
 * Undergraduate Calendar Glossary:
 *
 *   "Antirequisite — courses with significant overlap. Degree credit cannot be
 *    obtained for both the antirequisite and the course(s) naming it as such."
 *   Source: https://ucalendar.uwaterloo.ca/9900/INTRO/glossary.html
 *
 * That makes antireqs SYMMETRIC for degree credit: even though the data is
 * directional (a pair often names each other on only one side), placing either
 * one must block the other.
 */

function course(over: Partial<BaseCourse> = {}): Course {
  const base: BaseCourse = {
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

// Real antireq strings from the snapshot.
const CS116_ANTIREQ =
  "CS114, CS136, CS137, CS138, CS146, PHYS236, PHYS239, MSE240, NE111";
const CS136_ANTIREQ = "CS137, CS138, CS146, PHYS239"; // NB: does NOT name CS116
const CS115_ANTIREQ =
  "BME121, CS135, CS137, CS138, CS145, CHE121, CIVE121, ECE150, GENE121/MTE121, ME101, NE111, MSE121, PHYS139, SYDE121";

describe("antireqs are symmetric for degree credit (real CS data)", () => {
  it("flags CS136 when CS116 is placed, via the REVERSE index (CS136 doesn't name CS116)", () => {
    const cs116 = course({ code: "cs116", antireqs: CS116_ANTIREQ });
    const cs136 = course({ code: "cs136", antireqs: CS136_ANTIREQ });
    // CS136's own antireq list omits CS116, so only the reverse index catches it.
    expect(cs136.antireqs).not.toContain("CS116");

    const v = evaluateCourseEligibility(
      cs136,
      ctx({
        placedAnywhere: new Set(["cs116"]),
        placedAntireqNamers: placedAntireqNamers([cs116]),
      }),
    );
    expect(v.state).toBe("ineligible");
    expect(v.antireqConflicts).toContain("CS 116");
  });

  it("flags CS116 when CS136 is placed, via the FORWARD list (CS116 names CS136)", () => {
    const cs116 = course({ code: "cs116", antireqs: CS116_ANTIREQ });
    const cs136 = course({ code: "cs136", antireqs: CS136_ANTIREQ });

    const v = evaluateCourseEligibility(
      cs116,
      ctx({
        placedAnywhere: new Set(["cs136"]),
        placedAntireqNamers: placedAntireqNamers([cs136]),
      }),
    );
    expect(v.state).toBe("ineligible");
    expect(v.antireqConflicts).toContain("CS 136");
  });

  it("matches a slash-form antireq against either equivalent code (GENE121/MTE121)", () => {
    // CS115 names "GENE121/MTE121"; placing EITHER must block CS115.
    const cs115 = course({ code: "cs115", antireqs: CS115_ANTIREQ });
    for (const placed of ["gene121", "mte121"]) {
      const v = evaluateCourseEligibility(
        cs115,
        ctx({ placedAnywhere: new Set([placed]) }),
      );
      expect(v.state, `placed ${placed}`).toBe("ineligible");
      expect(v.antireqConflicts.length, `placed ${placed}`).toBeGreaterThan(0);
    }
  });

  it("builds the reverse index for every named antireq of a placed course", () => {
    const cs116 = course({ code: "cs116", antireqs: CS116_ANTIREQ });
    const index = placedAntireqNamers([cs116]);
    // CS116 names CS136 → CS136 maps back to CS116.
    expect(index.get("cs136")).toContain("cs116");
    expect(index.get("phys236")).toContain("cs116");
  });
});

describe("eligibility precedence (real restriction prose)", () => {
  const MATH: ProgramIdentity = {
    programId: "h-mathematics",
    names: ["mathematics", "math"],
    faculty: "mathematics",
  };
  // NB: Computer Science is itself in the Faculty of Mathematics, so a CS
  // student IS blocked by "Not open to Mathematics students." Use a clearly
  // non-Math program for the not-blocked case.
  const SYDE: ProgramIdentity = {
    programId: "systems-design-engineering",
    names: ["systems design engineering", "syde"],
    faculty: "engineering",
  };

  it("blocks CS105 for Mathematics students ('Not open to Mathematics students.')", () => {
    // CS105 prereq prose (snapshot): "Not open to Mathematics students."
    const cs105 = course({
      code: "cs105",
      prereqs: "Not open to Mathematics students.",
    });
    const v = evaluateCourseEligibility(cs105, ctx({ programs: [MATH] }));
    expect(v.state).toBe("ineligible");
    expect(v.blockedByProgram).toBe(true);
  });

  it("does not block CS105 for a non-Mathematics (CS-faculty aside) student", () => {
    const cs105 = course({
      code: "cs105",
      prereqs: "Not open to Mathematics students.",
    });
    // A student in a faculty the clause doesn't name is not blocked.
    const eng: ProgramIdentity = {
      programId: "systems-design-engineering",
      names: ["systems design engineering", "syde"],
      faculty: "engineering",
    };
    expect(
      evaluateCourseEligibility(cs105, ctx({ programs: [eng] })).state,
    ).not.toBe("ineligible");
  });

  it("a program block outranks an antireq conflict (both present)", () => {
    const c = course({
      code: "cs105",
      prereqs: "Not open to Mathematics students.",
      antireqs: "CS135",
    });
    const v = evaluateCourseEligibility(
      c,
      ctx({ programs: [MATH], placedAnywhere: new Set(["cs135"]) }),
    );
    expect(v.state).toBe("ineligible");
    expect(v.blockedByProgram).toBe(true); // ranked above the antireq reason
  });

  it("programReferenced demotes a stale program block to a 'check'", () => {
    const cs105 = course({
      code: "cs105",
      prereqs: "Not open to Mathematics students.",
    });
    const v = evaluateCourseEligibility(
      cs105,
      ctx({ programs: [MATH], programReferenced: new Set(["cs105"]) }),
    );
    expect(v.state).toBe("check");
    expect(v.blockedByProgram).toBe(false);
  });

  it("isProgramBlocked is term-independent for a real restriction", () => {
    const cs105 = course({
      code: "cs105",
      prereqs: "Not open to Mathematics students.",
    });
    expect(isProgramBlocked(cs105, { programs: [MATH] })).toBe(true);
    expect(isProgramBlocked(cs105, { programs: [SYDE] })).toBe(false);
  });
});
