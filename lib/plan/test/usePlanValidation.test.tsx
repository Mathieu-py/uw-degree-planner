// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Course } from "@/lib/courses/types";
import type { LocalPlan } from "../types";
import { usePlanValidation } from "../usePlanValidation";

function mkCourse(
  code: string,
  opts: { antireqCodes?: string[] } = {},
): Course {
  return {
    id: 0,
    code,
    name: code,
    prereqs: null,
    coreqs: null,
    antireqs: null,
    ...(opts.antireqCodes ? { antireqCodes: opts.antireqCodes } : {}),
    rating: null,
    sections: [],
    prefix: code.replace(/\d.*$/, "").toUpperCase(),
    level: 100,
    hasSeats: false,
  };
}

function mkPlan(slotCourses: string[]): LocalPlan {
  return {
    schemaVersion: 3,
    programIds: [],
    specializationIds: {},
    stream: "regular",
    startTermId: 1239,
    slots: [
      {
        id: "s1",
        termId: 1239,
        position: "1A",
        isCoop: false,
        courses: slotCourses.map((code) => ({ code })),
      },
    ],
    updatedAt: "2026-05-23T12:00:00.000Z",
  };
}

const CATALOG = [
  mkCourse("cs246", { antireqCodes: ["cs246e"] }),
  mkCourse("cs246e"),
];

describe("usePlanValidation", () => {
  it("builds catalogByCode keyed by course code", () => {
    const { result } = renderHook(() => usePlanValidation(null, CATALOG));
    expect(result.current.catalogByCode.get("cs246")?.code).toBe("cs246");
    expect(result.current.catalogByCode.size).toBe(2);
  });

  it("returns empty issues for a null plan but still builds the catalog map", () => {
    const { result } = renderHook(() => usePlanValidation(null, CATALOG));
    expect(result.current.issues).toEqual([]);
    expect(result.current.issuesPerSlot.size).toBe(0);
    expect(result.current.catalogByCode.size).toBe(2);
  });

  it("surfaces issues and groups them by slot", () => {
    const plan = mkPlan(["cs246", "cs246e"]);
    const { result } = renderHook(() => usePlanValidation(plan, CATALOG));
    const antireq = result.current.issues.filter((i) => i.kind === "antireq");
    expect(antireq.length).toBeGreaterThan(0);
    expect(result.current.issuesPerSlot.get("s1")).toEqual(
      result.current.issues,
    );
  });

  it("keeps stable references across rerenders with identical inputs", () => {
    const plan = mkPlan(["cs246"]);
    const { result, rerender } = renderHook(
      ({ p, c }) => usePlanValidation(p, c),
      { initialProps: { p: plan, c: CATALOG } },
    );
    const first = result.current;
    rerender({ p: plan, c: CATALOG });
    expect(result.current.catalogByCode).toBe(first.catalogByCode);
    expect(result.current.issues).toBe(first.issues);
    expect(result.current.issuesPerSlot).toBe(first.issuesPerSlot);
  });
});
