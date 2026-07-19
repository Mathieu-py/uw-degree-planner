import { describe, expect, it } from "vitest";
import { enrichCourse } from "@/lib/courses/filters";
import type { BaseCourse, Course } from "@/lib/courses/types";
import type { PlanSlot } from "@/lib/plan/types";
import { makeTermId } from "@/lib/terms";
import { computeTermOptions } from "../termOptions";

const FALL_2025 = makeTermId(2025, "Fall"); // → "Fall 2025"
const WINTER_2025 = makeTermId(2025, "Winter"); // → "Winter 2025"
const EMPTY: ReadonlySet<string> = new Set();

function slot(
  over: Partial<PlanSlot> & Pick<PlanSlot, "id" | "position">,
): PlanSlot {
  return { termId: null, isCoop: false, courses: [], ...over };
}

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

function placed(slots: PlanSlot[]): ReadonlySet<string> {
  return new Set(slots.flatMap((s) => s.courses.map((c) => c.code)));
}

function options(slots: PlanSlot[], c: Course) {
  return computeTermOptions(slots, c, [], EMPTY, placed(slots));
}

describe("computeTermOptions", () => {
  it("yields one option per academic term, excluding pre and co-op slots", () => {
    const slots = [
      slot({ id: "p", position: "pre" }),
      slot({ id: "a", position: "1A", termId: FALL_2025 }),
      slot({ id: "w", position: "coop1", termId: WINTER_2025, isCoop: true }),
      slot({ id: "b", position: "1B", termId: WINTER_2025 }),
    ];
    const opts = options(slots, course());
    expect(opts.map((o) => o.slot.id)).toEqual(["a", "b"]);
    expect(opts.map((o) => o.label)).toEqual(["Fall 2025", "Winter 2025"]);
  });

  it("marks every term eligible when the course has no prereqs", () => {
    const slots = [slot({ id: "a", position: "1A", termId: FALL_2025 })];
    expect(options(slots, course())[0].state).toBe("eligible");
  });

  it("marks a term missing when a required course is absent", () => {
    const slots = [slot({ id: "a", position: "1A", termId: FALL_2025 })];
    const opts = options(slots, course({ code: "cs200", prereqs: "MATH116" }));
    expect(opts[0].state).toBe("missing");
    expect(opts[0].hint).toMatch(/Needs/);
  });

  it("turns missing into eligible once the prereq sits in an earlier term", () => {
    const slots = [
      slot({
        id: "early",
        position: "1A",
        termId: WINTER_2025,
        courses: [{ code: "math116" }],
      }),
      slot({ id: "late", position: "1B", termId: FALL_2025 }),
    ];
    const opts = options(slots, course({ code: "cs200", prereqs: "MATH116" }));
    const byId = Object.fromEntries(opts.map((o) => [o.slot.id, o.state]));
    expect(byId.early).toBe("missing");
    expect(byId.late).toBe("eligible");
  });

  it("flags unparseable / program-only prerequisites as a manual check", () => {
    const slots = [slot({ id: "a", position: "1A", termId: FALL_2025 })];
    const opts = options(
      slots,
      course({ code: "cs200", prereqs: "Honours Mathematics students only" }),
    );
    expect(opts[0].state).toBe("check");
  });

  it("resolves a level-only prereq from the slot's position, never 'check'", () => {
    const slots = [
      slot({ id: "1a", position: "1A", termId: makeTermId(2025, "Fall") }),
      slot({ id: "1b", position: "1B", termId: makeTermId(2026, "Winter") }),
      slot({ id: "2a", position: "2A", termId: makeTermId(2026, "Fall") }),
      slot({ id: "2b", position: "2B", termId: makeTermId(2027, "Winter") }),
    ];
    const opts = options(
      slots,
      course({ code: "cs246", prereqs: "Level at least 2A" }),
    );
    const byId = Object.fromEntries(opts.map((o) => [o.slot.id, o.state]));
    expect(byId["1a"]).toBe("missing");
    expect(byId["1b"]).toBe("missing");
    expect(byId["2a"]).toBe("eligible");
    expect(byId["2b"]).toBe("eligible");
    expect(opts.map((o) => o.state)).not.toContain("check");
  });

  it("marks every term missing when an antireq is already placed", () => {
    const slots = [
      slot({
        id: "a",
        position: "1A",
        termId: FALL_2025,
        courses: [{ code: "math138" }],
      }),
      slot({ id: "b", position: "1B", termId: WINTER_2025 }),
    ];
    const opts = options(
      slots,
      course({ code: "math119", antireqs: "MATH138" }),
    );
    expect(opts.every((o) => o.state === "missing")).toBe(true);
    expect(opts[0].hint).toMatch(/Antireq/i);
  });

  it("flags an unmet coreq as a check, not missing", () => {
    const slots = [slot({ id: "a", position: "1A", termId: FALL_2025 })];
    const opts = options(slots, course({ code: "phys121", coreqs: "MATH117" }));
    expect(opts[0].state).toBe("check");
    expect(opts[0].hint).toMatch(/Coreq/i);
  });

  it("treats a coreq satisfied in the same term as eligible", () => {
    const slots = [
      slot({
        id: "a",
        position: "1A",
        termId: FALL_2025,
        courses: [{ code: "math117" }],
      }),
    ];
    const opts = options(slots, course({ code: "phys121", coreqs: "MATH117" }));
    expect(opts[0].state).toBe("eligible");
  });
});

// Placement labelling for the "already placed" banner lives in
// placedCourseLabel (lib/plan/derive) and is covered by useTermOptions.
