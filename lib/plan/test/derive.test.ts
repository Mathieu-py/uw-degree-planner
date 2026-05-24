import { describe, expect, it } from "vitest";
import { completedCoursesFromPlan, completedSetFromPlan } from "../derive";
import type { LocalPlan } from "../types";

const PLAN: LocalPlan = {
  version: 1,
  programId: "software-engineering",
  specializationId: null,
  stream: "stream8",
  startTermId: 1239,
  slots: [
    {
      id: "pre",
      termId: null,
      position: "pre",
      isCoop: false,
      courses: [{ code: "transfer1" }, { code: "transfer2" }],
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
      id: "2A",
      termId: 1249,
      position: "2A",
      isCoop: false,
      courses: [{ code: "se212" }, { code: "ece222" }],
    },
  ],
  updatedAt: "2026-05-23T12:00:00.000Z",
};

describe("completedCoursesFromPlan", () => {
  it("returns every placed code when asOfTermId is omitted", () => {
    expect(completedCoursesFromPlan(PLAN)).toEqual([
      "cs136",
      "ece222",
      "math115",
      "se101",
      "se212",
      "transfer1",
      "transfer2",
    ]);
  });

  it("includes only slots whose termId is strictly less than asOfTermId", () => {
    // Cutoff at start of 2A (1249) — includes pre + 1A + 1B but NOT 2A.
    expect(completedCoursesFromPlan(PLAN, 1249)).toEqual([
      "cs136",
      "math115",
      "se101",
      "transfer1",
      "transfer2",
    ]);
  });

  it("always includes the pre-arrival transfer slot regardless of cutoff", () => {
    // Cutoff at 1A start — no academic slots qualify, but transfers should remain.
    expect(completedCoursesFromPlan(PLAN, 1239)).toEqual([
      "transfer1",
      "transfer2",
    ]);
  });

  it("returns sorted, deduplicated codes", () => {
    const dup: LocalPlan = {
      ...PLAN,
      slots: [
        {
          id: "a",
          termId: 1239,
          position: "1A",
          isCoop: false,
          courses: [{ code: "cs246" }, { code: "cs246" }],
        },
      ],
    };
    expect(completedCoursesFromPlan(dup)).toEqual(["cs246"]);
  });
});

describe("completedSetFromPlan", () => {
  it("returns a Set with the same membership as the list form", () => {
    const set = completedSetFromPlan(PLAN, 1249);
    expect(set).toBeInstanceOf(Set);
    expect([...set].sort()).toEqual([
      "cs136",
      "math115",
      "se101",
      "transfer1",
      "transfer2",
    ]);
  });
});
