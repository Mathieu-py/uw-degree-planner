import { describe, expect, it } from "vitest";
import {
  applyFilters,
  enrichCourse,
  passesIncludePrefixes,
  passesLevelFilter,
  passesMinEasyFilter,
  passesMinUsefulFilter,
  passesPrefixExclusion,
  passesSeatsFilter,
  seatsAvailable,
} from "../filters";
import { DEFAULT_FILTER_STATE } from "../filterState";
import type { Course, UWFlowCourse, UWFlowRating } from "../types";

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

function rating(overrides: Partial<UWFlowRating> = {}): UWFlowRating {
  return {
    easy: null,
    useful: null,
    liked: null,
    filled_count: null,
    ...overrides,
  };
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

  it("hasSeats=false when there are no sections", () => {
    const c = makeCourse({ sections: [] });
    expect(c.hasSeats).toBe(false);
  });

  it("handles multi-letter prefixes and trailing letters in code", () => {
    const c = makeCourse({ code: "msci261b" });
    expect(c.prefix).toBe("MSCI");
    expect(c.level).toBe(261);
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
  it("empty exclusion list passes everything", () => {
    expect(passesPrefixExclusion(makeCourse({ code: "fr101" }), [])).toBe(true);
  });
});

describe("passesIncludePrefixes", () => {
  it("empty whitelist passes everything (rule disabled)", () => {
    const c = makeCourse({ code: "fr101" });
    expect(passesIncludePrefixes(c, [])).toBe(true);
  });
  it("only listed prefixes pass when whitelist is set", () => {
    expect(passesIncludePrefixes(makeCourse({ code: "math116" }), ["MATH", "CS"])).toBe(true);
    expect(passesIncludePrefixes(makeCourse({ code: "fr101" }), ["MATH", "CS"])).toBe(false);
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
  it("empty levels list passes everything", () => {
    expect(passesLevelFilter(makeCourse({ code: "cs450" }), [])).toBe(true);
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
  it("passes when at least one section has open seats", () => {
    const c = makeCourse({
      sections: [
        { id: 1, enrollment_total: 30, enrollment_capacity: 30 },
        { id: 2, enrollment_total: 10, enrollment_capacity: 30 },
      ],
    });
    expect(passesSeatsFilter(c, true)).toBe(true);
  });
});

describe("passesMinUsefulFilter", () => {
  it("null threshold passes everything (rule disabled)", () => {
    expect(passesMinUsefulFilter(makeCourse({ rating: null }), null)).toBe(true);
  });
  it("rejects when useful rating is below threshold", () => {
    const c = makeCourse({ rating: rating({ useful: 0.4 }) });
    expect(passesMinUsefulFilter(c, 0.5)).toBe(false);
  });
  it("passes when useful rating meets or exceeds threshold", () => {
    const c = makeCourse({ rating: rating({ useful: 0.5 }) });
    expect(passesMinUsefulFilter(c, 0.5)).toBe(true);
    expect(passesMinUsefulFilter(makeCourse({ rating: rating({ useful: 0.9 }) }), 0.5)).toBe(true);
  });
  it("treats null rating as 0 and rejects against a positive threshold", () => {
    expect(passesMinUsefulFilter(makeCourse({ rating: null }), 0.1)).toBe(false);
  });
  it("treats null rating as 0 and passes a zero threshold", () => {
    expect(passesMinUsefulFilter(makeCourse({ rating: null }), 0)).toBe(true);
  });
});

describe("passesMinEasyFilter", () => {
  it("null threshold passes everything (rule disabled)", () => {
    expect(passesMinEasyFilter(makeCourse({ rating: null }), null)).toBe(true);
  });
  it("rejects when easy rating is below threshold", () => {
    const c = makeCourse({ rating: rating({ easy: 0.2 }) });
    expect(passesMinEasyFilter(c, 0.5)).toBe(false);
  });
  it("passes when easy rating meets or exceeds threshold", () => {
    const c = makeCourse({ rating: rating({ easy: 0.5 }) });
    expect(passesMinEasyFilter(c, 0.5)).toBe(true);
  });
  it("treats null rating as 0 and rejects against a positive threshold", () => {
    expect(passesMinEasyFilter(makeCourse({ rating: null }), 0.1)).toBe(false);
  });
});

describe("seatsAvailable", () => {
  it("returns null when there are no sections", () => {
    expect(seatsAvailable(makeCourse({ sections: [] }))).toBeNull();
  });

  it("sums (capacity - total) across sections", () => {
    const c = makeCourse({
      sections: [
        { id: 1, enrollment_total: 10, enrollment_capacity: 30 },
        { id: 2, enrollment_total: 25, enrollment_capacity: 30 },
      ],
    });
    expect(seatsAvailable(c)).toBe(25);
  });

  it("clamps oversubscribed sections to 0 instead of going negative", () => {
    const c = makeCourse({
      sections: [
        { id: 1, enrollment_total: 35, enrollment_capacity: 30 },
        { id: 2, enrollment_total: 10, enrollment_capacity: 30 },
      ],
    });
    expect(seatsAvailable(c)).toBe(20);
  });
});

describe("applyFilters", () => {
  const mathCourse = makeCourse({
    code: "math116",
    rating: rating({ useful: 0.8, easy: 0.4 }),
    sections: [{ id: 1, enrollment_total: 10, enrollment_capacity: 30 }],
  });
  const philCourse = makeCourse({
    id: 2,
    code: "phil110",
    rating: rating({ useful: 0.3, easy: 0.9 }),
    sections: [{ id: 2, enrollment_total: 30, enrollment_capacity: 30 }],
  });
  const csCourse = makeCourse({
    id: 3,
    code: "cs486",
    rating: rating({ useful: 0.9, easy: 0.2 }),
    sections: [{ id: 3, enrollment_total: 5, enrollment_capacity: 50 }],
  });
  const all = [mathCourse, philCourse, csCourse];

  it("returns every course when state is the default", () => {
    expect(applyFilters(all, DEFAULT_FILTER_STATE)).toEqual(all);
  });

  it("AND-chains the predicates: exclude PHIL + require seats", () => {
    const result = applyFilters(all, {
      ...DEFAULT_FILTER_STATE,
      excludePrefixes: ["PHIL"],
      hasSeatsAvailable: true,
    });
    expect(result.map((c) => c.code)).toEqual(["math116", "cs486"]);
  });

  it("include whitelist narrows to listed prefixes only", () => {
    const result = applyFilters(all, {
      ...DEFAULT_FILTER_STATE,
      includePrefixes: ["MATH"],
    });
    expect(result.map((c) => c.code)).toEqual(["math116"]);
  });

  it("combines level + minUseful thresholds", () => {
    const result = applyFilters(all, {
      ...DEFAULT_FILTER_STATE,
      levels: [400],
      minUseful: 0.5,
    });
    expect(result.map((c) => c.code)).toEqual(["cs486"]);
  });

  it("returns empty when filters exclude every course", () => {
    const result = applyFilters(all, {
      ...DEFAULT_FILTER_STATE,
      excludePrefixes: ["MATH", "PHIL", "CS"],
    });
    expect(result).toEqual([]);
  });
});
