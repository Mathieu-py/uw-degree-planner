import { describe, expect, it } from "vitest";
import {
  addCourseToSlot,
  removeCourseFromSlot,
  reseedSlotIds,
} from "../mutateSlots";
import type { LocalPlan } from "../types";

const PLAN: LocalPlan = {
  schemaVersion: 3,
  programIds: ["software-engineering"],
  specializationIds: {},
  stream: "stream8",
  startTermId: 1239,
  slots: [
    {
      id: "1A",
      termId: 1239,
      position: "1A",
      isCoop: false,
      courses: [{ code: "math115" }, { code: "se101", outcome: "credit" }],
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

  it("preserves an outcome carried on the course", () => {
    const next = addCourseToSlot(PLAN, "1B", {
      code: "se102",
      outcome: "credit",
    });
    expect(slot(next, "1B").courses).toContainEqual({
      code: "se102",
      outcome: "credit",
    });
  });

  it("is a no-op (same reference) when the target already has the code", () => {
    expect(addCourseToSlot(PLAN, "1A", { code: "MATH115" })).toBe(PLAN);
  });

  it("is a no-op for an unknown slot", () => {
    expect(addCourseToSlot(PLAN, "nope", { code: "cs246" })).toBe(PLAN);
  });

  it("is generic over the plan shape, preserving non-slot fields", () => {
    // A ServerPlan-shaped value (carries id/name, no schemaVersion). The
    // catalog's signed-in add relies on getting the same shape back.
    const serverLike = {
      id: "plan-1",
      name: "My plan",
      programIds: ["se"],
      slots: PLAN.slots,
    };
    const next = addCourseToSlot(serverLike, "1B", { code: "cs246" });
    expect(next.id).toBe("plan-1");
    expect(next.name).toBe("My plan");
    expect(
      next.slots.find((s) => s.id === "1B")?.courses.map((c) => c.code),
    ).toEqual(["cs136", "cs246"]);
  });
});

describe("reseedSlotIds", () => {
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  it("mints fresh unique UUIDs and keeps everything else", () => {
    const next = reseedSlotIds(PLAN);
    const ids = next.slots.map((s) => s.id);
    expect(ids.every((id) => UUID_RE.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(next.slots.map((s) => ({ ...s, id: "x" }))).toEqual(
      PLAN.slots.map((s) => ({ ...s, id: "x" })),
    );
    expect(next.stream).toBe(PLAN.stream);
  });

  it("does not mutate the input", () => {
    reseedSlotIds(PLAN);
    expect(PLAN.slots.map((s) => s.id)).toEqual(["1A", "1B"]);
  });

  it("is generic over the container (snapshot-shaped in, same shape out)", () => {
    const snapshotLike = { programIds: ["se"], slots: PLAN.slots };
    const next = reseedSlotIds(snapshotLike);
    expect(next.programIds).toEqual(["se"]);
    expect(next.slots[0].id).not.toBe("1A");
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
