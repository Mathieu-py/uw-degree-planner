import { describe, expect, it } from "vitest";
import {
  applyCourseDrop,
  COURSE_DRAG_MIME,
  type CourseDragData,
  courseDragKind,
  hasCourseDrag,
  readCourseDrag,
  writeCourseDrag,
} from "../dnd";
import type { LocalPlan } from "../types";
import { fakeDataTransfer } from "./fakeDataTransfer";

const PLAN: LocalPlan = {
  schemaVersion: 3,
  programIds: ["software-engineering"],
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
    {
      id: "coop1",
      termId: 1245,
      position: "coop1",
      isCoop: true,
      courses: [],
    },
  ],
  updatedAt: "2026-05-23T12:00:00.000Z",
};

function slot(plan: LocalPlan, id: string) {
  const s = plan.slots.find((x) => x.id === id);
  if (!s) throw new Error(`no slot ${id}`);
  return s;
}

describe("applyCourseDrop — move", () => {
  it("moves a course between academic terms and preserves its grade", () => {
    const data: CourseDragData = {
      kind: "move",
      fromSlotId: "1A",
      code: "se101",
    };
    const next = applyCourseDrop(PLAN, "1B", data);

    expect(next).not.toBe(PLAN);
    expect(slot(next, "1A").courses.map((c) => c.code)).toEqual(["math115"]);
    expect(slot(next, "1B").courses).toContainEqual({
      code: "se101",
      grade: "85",
    });
  });

  it("is a no-op (same reference) when dropping onto the same term", () => {
    const next = applyCourseDrop(PLAN, "1A", {
      kind: "move",
      fromSlotId: "1A",
      code: "math115",
    });
    expect(next).toBe(PLAN);
  });

  it("is a no-op when the target already has the course", () => {
    const planWithDup: LocalPlan = {
      ...PLAN,
      slots: PLAN.slots.map((s) =>
        s.id === "1B" ? { ...s, courses: [{ code: "math115" }] } : s,
      ),
    };
    const next = applyCourseDrop(planWithDup, "1B", {
      kind: "move",
      fromSlotId: "1A",
      code: "math115",
    });
    expect(next).toBe(planWithDup);
  });

  it("is a no-op when the source course is missing", () => {
    const next = applyCourseDrop(PLAN, "1B", {
      kind: "move",
      fromSlotId: "1A",
      code: "phys121",
    });
    expect(next).toBe(PLAN);
  });
});

describe("applyCourseDrop — add", () => {
  it("appends a new course to the target term", () => {
    const next = applyCourseDrop(PLAN, "1B", { kind: "add", code: "cs246" });
    expect(next).not.toBe(PLAN);
    expect(slot(next, "1B").courses.map((c) => c.code)).toEqual([
      "cs136",
      "cs246",
    ]);
  });

  it("lowercases the code and dedupes against the target", () => {
    const next = applyCourseDrop(PLAN, "1A", { kind: "add", code: "MATH115" });
    expect(next).toBe(PLAN);
  });
});

describe("applyCourseDrop — invalid targets", () => {
  it("rejects drops onto a co-op term", () => {
    expect(applyCourseDrop(PLAN, "coop1", { kind: "add", code: "cs246" })).toBe(
      PLAN,
    );
  });

  it("rejects drops onto the pre-arrival slot", () => {
    expect(applyCourseDrop(PLAN, "pre", { kind: "add", code: "cs246" })).toBe(
      PLAN,
    );
  });

  it("rejects drops onto an unknown slot", () => {
    expect(applyCourseDrop(PLAN, "nope", { kind: "add", code: "cs246" })).toBe(
      PLAN,
    );
  });
});

describe("course drag payload helpers", () => {
  it("round-trips a payload through write/read", () => {
    const dt = fakeDataTransfer();
    const e = { dataTransfer: dt as unknown as DataTransfer };
    const data: CourseDragData = {
      kind: "move",
      fromSlotId: "1A",
      code: "se101",
    };
    writeCourseDrag(e, data);

    expect(dt.types).toContain(COURSE_DRAG_MIME);
    expect(dt.getData("text/plain")).toBe("se101");
    expect(dt.effectAllowed).toBe("move");
    expect(hasCourseDrag(e)).toBe(true);
    expect(courseDragKind(e)).toBe("move");
    expect(readCourseDrag(e)).toEqual(data);
  });

  it("reports the drag kind from types alone (readable during dragover)", () => {
    const dt = fakeDataTransfer();
    const e = { dataTransfer: dt as unknown as DataTransfer };
    writeCourseDrag(e, { kind: "add", code: "cs246" });
    expect(courseDragKind(e)).toBe("add");
  });

  it("ignores a drag that carries no course payload", () => {
    const dt = fakeDataTransfer();
    dt.setData("text/plain", "just text");
    const e = { dataTransfer: dt as unknown as DataTransfer };
    expect(hasCourseDrag(e)).toBe(false);
    expect(readCourseDrag(e)).toBeNull();
  });

  it("returns null for a garbled payload", () => {
    const dt = fakeDataTransfer();
    dt.setData(COURSE_DRAG_MIME, "{not json");
    const e = { dataTransfer: dt as unknown as DataTransfer };
    expect(readCourseDrag(e)).toBeNull();
  });

  it("rejects a payload whose code isn't a catalog course code", () => {
    const dt = fakeDataTransfer();
    dt.setData(
      COURSE_DRAG_MIME,
      JSON.stringify({ kind: "add", code: "../../etc/passwd" }),
    );
    const e = { dataTransfer: dt as unknown as DataTransfer };
    expect(readCourseDrag(e)).toBeNull();
  });

  it("marks an add drag as a copy and a move drag as a move", () => {
    const addDt = fakeDataTransfer();
    writeCourseDrag(
      { dataTransfer: addDt as unknown as DataTransfer },
      {
        kind: "add",
        code: "cs246",
      },
    );
    expect(addDt.effectAllowed).toBe("copy");

    const moveDt = fakeDataTransfer();
    writeCourseDrag(
      { dataTransfer: moveDt as unknown as DataTransfer },
      {
        kind: "move",
        fromSlotId: "1A",
        code: "se101",
      },
    );
    expect(moveDt.effectAllowed).toBe("move");
  });
});
