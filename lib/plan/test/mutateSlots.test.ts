import { describe, expect, it } from "vitest";
import { addCourseToSlot, removeCourseFromSlot } from "../mutateSlots";
import type { LocalPlan } from "../types";

const PLAN: LocalPlan = {
  schemaVersion: 1,
  programId: "software-engineering",
  specializationId: null,
  stream: "stream8",
  startTermId: 1239,
  slots: [
    {
      id: "1A",
      termId: 1239,
      position: "1A",
      isCoop: false,
      courses: [{ code: "math115" }, { code: "se101", grade: "85" }],
    },
    {
      id: "1B",
      termId: 1241,
      position: "1B",
      isCoop: false,
      courses: [{ code: "cs136" }],
    },
  ],
  updatedAt: "2026-05-23T12:00:00.000Z",
};

function slot(plan: LocalPlan, id: string) {
  const s = plan.slots.find((x) => x.id === id);
  if (!s) throw new Error(`no slot ${id}`);
  return s;
}

describe("addCourseToSlot", () => {
  it("appends to the target term and lowercases the code", () => {
    const next = addCourseToSlot(PLAN, "1B", { code: "CS246" });
    expect(next).not.toBe(PLAN);
    expect(slot(next, "1B").courses.map((c) => c.code)).toEqual([
      "cs136",
      "cs246",
    ]);
  });

  it("preserves a grade carried on the course", () => {
    const next = addCourseToSlot(PLAN, "1B", { code: "se102", grade: "90" });
    expect(slot(next, "1B").courses).toContainEqual({
      code: "se102",
      grade: "90",
    });
  });

  it("is a no-op (same reference) when the target already has the code", () => {
    expect(addCourseToSlot(PLAN, "1A", { code: "MATH115" })).toBe(PLAN);
  });

  it("is a no-op for an unknown slot", () => {
    expect(addCourseToSlot(PLAN, "nope", { code: "cs246" })).toBe(PLAN);
  });
});

describe("removeCourseFromSlot", () => {
  it("removes the course and lowercases the lookup", () => {
    const next = removeCourseFromSlot(PLAN, "1A", "SE101");
    expect(next).not.toBe(PLAN);
    expect(slot(next, "1A").courses.map((c) => c.code)).toEqual(["math115"]);
  });

  it("is a no-op when the course is absent", () => {
    expect(removeCourseFromSlot(PLAN, "1A", "phys121")).toBe(PLAN);
  });

  it("is a no-op for an unknown slot", () => {
    expect(removeCourseFromSlot(PLAN, "nope", "math115")).toBe(PLAN);
  });
});
