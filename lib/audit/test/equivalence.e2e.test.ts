import { describe, expect, it } from "vitest";
import { equivalenceForCatalog } from "@/lib/courses/equivalence";
import type { Course } from "@/lib/courses/types";
import { eligibleSlotIdsForCourse } from "@/lib/plan/eligibleTerms";
import type { LocalPlan } from "@/lib/plan/types";
import { validatePlan } from "@/lib/plan/validate";
import type { Program } from "@/lib/programs";
import { compileAudit } from "../compile";
import { computeDegreeProgress } from "../progress";

/**
 * End-to-end course-equivalence path. One catalog with a cross-listed pair
 * (amath242 ≡ cs371) threaded through every consumer — plan validation, the
 * picker's eligible-term calc, audit compilation, and the degree headline — to
 * prove they agree: the placed twin satisfies a requirement, a prereq, and reads
 * as already-placed, with no spurious conflict. Mirrors buildProgramAudit's wiring.
 */

function mkCourse(code: string, opts: Partial<Course> = {}): Course {
  return {
    id: 0,
    code,
    name: code,
    prereqs: null,
    coreqs: null,
    antireqs: null,
    rating: null,
    sections: [],
    prefix: code.replace(/\d.*$/, "").toUpperCase(),
    level: 100,
    hasSeats: false,
    units: 0.5,
    ...opts,
  };
}

// amath242 and cs371 are the same course, cross-listed.
const catalog = new Map<string, Course>(
  [
    mkCourse("amath242", { crossListed: ["cs371"] }),
    mkCourse("cs371", { crossListed: ["amath242"] }),
    mkCourse("cs350", { prereqAst: { kind: "course", code: "amath242" } }),
  ].map((c) => [c.code, c]),
);

const program: Program = {
  kind: "flexible",
  name: "Toy",
  asOf: "2026",
  rules: {
    kind: "all",
    children: [{ kind: "courses", courses: ["amath242"] }],
  },
};

// Student took the CS-listed twin (1A), then cs350 (2A) which needs amath242.
const plan: LocalPlan = {
  schemaVersion: 3,
  programIds: ["test"],
  specializationIds: {},
  stream: "regular",
  startTermId: 1239,
  slots: [
    {
      id: "s1",
      termId: 1239,
      position: "1A",
      isCoop: false,
      courses: [{ code: "cs371" }],
    },
    {
      id: "s2",
      termId: 1245,
      position: "2A",
      isCoop: false,
      courses: [{ code: "cs350" }],
    },
  ],
  updatedAt: "2026-05-23T12:00:00.000Z",
};

describe("course equivalence — end-to-end", () => {
  it("the twin satisfies a downstream prereq without a spurious conflict", () => {
    const issues = validatePlan(plan, catalog);
    // cs350's prereq amath242 is met by the placed twin cs371; nothing conflicts.
    expect(
      issues.filter((i) => i.kind === "prereq" || i.kind === "antireq"),
    ).toEqual([]);
  });

  it("the requirement's exact code reads as already-placed via its twin", () => {
    // cs371 is placed, so its twin amath242 can't be added anywhere.
    expect(eligibleSlotIdsForCourse(plan, "amath242", catalog).size).toBe(0);
  });

  it("audit and headline agree the requirement is met (shared index)", () => {
    const equiv = equivalenceForCatalog(catalog);
    const audit = compileAudit(program, plan, null, new Set(), null, equiv);
    expect(audit.flexibleRoot?.status).toBe("met");

    const progress = computeDegreeProgress(
      audit,
      program,
      (code) => catalog.get(code)?.units ?? 0.5,
      new Set(),
      equiv,
    );
    expect(progress.allComplete).toBe(true);
    expect(progress.pct).toBe(100);
  });
});
