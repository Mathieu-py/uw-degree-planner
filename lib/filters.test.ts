import { describe, expect, it } from "vitest";
import {
  enrichCourse,
  passesLevelFilter,
  passesPrefixExclusion,
  passesSeatsFilter,
} from "./filters";
import type { UWFlowCourse } from "./types";

function makeCourse(overrides: Partial<UWFlowCourse> = {}) {
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

describe("enrichCourse", () => {
  it("derives prefix, level, and hasSeats", () => {
    const c = makeCourse({
      code: "math116",
      sections: [{ id: 1, enrollment_total: 10, enrollment_capacity: 30 }],
    });
    expect(c.prefix).toBe("MATH");
    expect(c.level).toBe(116);
    expect(c.hasSeats).toBe(true);
  });

  it("hasSeats=false when every section is full", () => {
    const c = makeCourse({
      sections: [{ id: 1, enrollment_total: 30, enrollment_capacity: 30 }],
    });
    expect(c.hasSeats).toBe(false);
  });
});

describe("passesPrefixExclusion", () => {
  it("rejects excluded prefix", () => {
    const c = makeCourse({ code: "fr101" });
    expect(passesPrefixExclusion(c, ["FR"])).toBe(false);
  });
  it("passes other prefixes", () => {
    const c = makeCourse({ code: "fr101" });
    expect(passesPrefixExclusion(c, ["GER"])).toBe(true);
  });
});

describe("passesLevelFilter", () => {
  it.each([
    ["math116", [100], true],
    ["math116", [200], false],
    ["cs450", [100, 200, 300], false],
    ["cs450", [400], true],
  ])("%s in levels=%o → %s", (code, levels, expected) => {
    expect(passesLevelFilter(makeCourse({ code }), levels)).toBe(expected);
  });
});

describe("passesSeatsFilter", () => {
  it("rejects when no sections", () => {
    expect(passesSeatsFilter(makeCourse({ sections: [] }), true)).toBe(false);
  });
  it("rejects when all sections full", () => {
    const c = makeCourse({
      sections: [{ id: 1, enrollment_total: 30, enrollment_capacity: 30 }],
    });
    expect(passesSeatsFilter(c, true)).toBe(false);
  });
  it("ignores filter when not required", () => {
    expect(passesSeatsFilter(makeCourse({ sections: [] }), false)).toBe(true);
  });
});
