import { describe, expect, it } from "vitest";
import type { ProgramIdentity } from "@/lib/programs";
import {
  type AttachEligibilityOptions,
  attachEligibility,
  type EligibilityRow,
} from "../eligibility";
import { enrichCourse } from "../filters";
import type { Course, UWFlowCourse } from "../types";

const SYDE: ProgramIdentity = {
  programId: "systems-design-engineering",
  names: ["systems design engineering", "syde"],
  faculty: "engineering",
};

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

function makeRows(courses: Course[]): EligibilityRow[] {
  return courses.map((course) => ({ course, eligibility: null }));
}

// attachEligibility with the always-required fields defaulted, so each test
// only states the bits it cares about.
function attach(
  rows: EligibilityRow[],
  opts: Partial<AttachEligibilityOptions> &
    Pick<AttachEligibilityOptions, "completed">,
): EligibilityRow[] {
  return attachEligibility(rows, {
    placedAnywhere: opts.placedAnywhere ?? new Set(),
    hideUnmetPrereqs: opts.hideUnmetPrereqs ?? false,
    ...opts,
  });
}

describe("attachEligibility", () => {
  it("leaves eligibility null (and keeps the row) when completed is empty and there's no antireq/duplicate", () => {
    const rows = makeRows([makeCourse({ code: "cs136", prereqs: "CS135" })]);
    const out = attach(rows, { completed: new Set(), hideUnmetPrereqs: true });
    expect(out).toHaveLength(1);
    expect(out[0].eligibility).toBeNull();
  });

  it("computes a verdict for every row when completed is non-empty", () => {
    const rows = makeRows([makeCourse({ code: "cs136", prereqs: "CS135" })]);
    const out = attach(rows, { completed: new Set(["cs135"]) });
    expect(out[0].eligibility?.state).toBe("eligible");
  });

  it("filters out rows with unmet prereqs when hideUnmetPrereqs=true", () => {
    const rows = makeRows([makeCourse({ code: "cs136", prereqs: "CS135" })]);
    const out = attach(rows, {
      completed: new Set(["math137"]),
      hideUnmetPrereqs: true,
    });
    expect(out).toHaveLength(0);
  });

  it("keeps rows with unmet prereqs as ineligible when hideUnmetPrereqs=false", () => {
    const rows = makeRows([makeCourse({ code: "cs136", prereqs: "CS135" })]);
    const out = attach(rows, { completed: new Set(["math137"]) });
    expect(out).toHaveLength(1);
    expect(out[0].eligibility?.state).toBe("ineligible");
  });

  it("resolves a level-gated prereq definitively when level is provided", () => {
    const rows = makeRows([
      makeCourse({ code: "cs246", prereqs: "Level at least 2A" }),
    ]);
    expect(
      attach(rows, { completed: new Set(["cs135"]), level: "2A" })[0]
        .eligibility?.state,
    ).toBe("eligible");
    expect(
      attach(rows, { completed: new Set(["cs135"]), level: "1B" })[0]
        .eligibility?.state,
    ).toBe("ineligible");
  });

  it("leaves a level-gated prereq as 'check' when no level is given", () => {
    const rows = makeRows([
      makeCourse({ code: "cs246", prereqs: "Level at least 2A" }),
    ]);
    expect(
      attach(rows, { completed: new Set(["cs135"]) })[0].eligibility?.state,
    ).toBe("check");
  });

  it("blocks a course reserved to another program (not program-referenced)", () => {
    const rows = makeRows([
      makeCourse({ code: "anth101", prereqs: "Anthropology students only" }),
    ]);
    const out = attach(rows, {
      completed: new Set(["cs135"]),
      programs: [SYDE],
    });
    expect(out[0].eligibility?.state).toBe("ineligible");
    expect(
      attach(rows, {
        completed: new Set(["cs135"]),
        hideUnmetPrereqs: true,
        programs: [SYDE],
      }),
    ).toHaveLength(0);
  });

  it("does NOT block a program-restricted course the program references (required-aware)", () => {
    // MATH 119-style: restricted to SWE only, but the SYDE program references it
    // and the OR-prereq is met. The program clause demotes to a soft "check"
    // rather than greying the course out.
    const rows = makeRows([
      makeCourse({
        code: "math119",
        prereqs:
          "One of MATH116, MATH117; Open only to students in Software Engineering",
      }),
    ]);
    const out = attach(rows, {
      completed: new Set(["math117"]),
      placedAnywhere: new Set(["math117"]),
      hideUnmetPrereqs: true,
      level: "2A",
      programs: [SYDE],
      programReferenced: new Set(["math119"]),
    });
    expect(out).toHaveLength(1); // not hidden
    expect(out[0].eligibility?.state).not.toBe("ineligible");
  });

  it("blocks a course whose antireq is already placed — even with an empty completed set", () => {
    const rows = makeRows([
      makeCourse({ code: "math119", antireqs: "MATH138" }),
    ]);
    // Empty completed (e.g. picking for term 1A) must still hide the antireq.
    const out = attach(rows, {
      completed: new Set(),
      placedAnywhere: new Set(["math138"]),
      hideUnmetPrereqs: true,
    });
    expect(out).toHaveLength(0);
    const shown = attach(rows, {
      completed: new Set(),
      placedAnywhere: new Set(["math138"]),
    });
    expect(shown[0].eligibility?.state).toBe("ineligible");
    expect(shown[0].eligibility?.antireqConflicts).toContain("MATH 138");
  });
});
