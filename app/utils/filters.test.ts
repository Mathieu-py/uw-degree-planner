import { describe, expect, it } from "vitest";
import {
  enrichCourse,
  passesAncientMedievalFilter,
  passesEnvKeywordFilter,
  passesEssayHeavyFilter,
  passesLevelFilter,
  passesPrefixExclusion,
  passesRatingAndThreshold,
  passesSeatsFilter,
  passesWLUFilter,
} from "./filters";
import type { UWFlowCourse } from "~/types";

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

describe("passesEssayHeavyFilter", () => {
  it("rejects PHIL by default", () => {
    const c = makeCourse({ code: "phil101" });
    expect(passesEssayHeavyFilter(c, false)).toBe(false);
  });
  it("allows psych101 exception", () => {
    const c = makeCourse({ code: "psych101" });
    expect(passesEssayHeavyFilter(c, true)).toBe(true);
    expect(passesEssayHeavyFilter(c, false)).toBe(false);
  });
});

describe("passesAncientMedievalFilter", () => {
  it.each([
    ["Ancient Greek Philosophy", false],
    ["Medieval Studies", false],
    ["Modern Calculus", true],
  ])("%s → %s", (name, expected) => {
    const c = makeCourse({ name });
    expect(passesAncientMedievalFilter(c)).toBe(expected);
  });
});

describe("passesWLUFilter", () => {
  it("rejects WLU mention in name", () => {
    const c = makeCourse({ name: "WLU Joint Program" });
    expect(passesWLUFilter(c)).toBe(false);
  });
  it("rejects codes ending in w", () => {
    const c = makeCourse({ code: "comm100w" });
    expect(passesWLUFilter(c)).toBe(false);
  });
});

describe("passesEnvKeywordFilter", () => {
  it("rejects environment/climate/sustainability in name", () => {
    expect(passesEnvKeywordFilter(makeCourse({ name: "Climate Action" }))).toBe(false);
    expect(passesEnvKeywordFilter(makeCourse({ name: "Sustainability 101" }))).toBe(false);
    expect(passesEnvKeywordFilter(makeCourse({ name: "Environmental Law" }))).toBe(false);
  });
});

describe("passesRatingAndThreshold", () => {
  const threshold = { easy: 0.4, useful: 0.5 };
  it("drops when both below thresholds", () => {
    const c = makeCourse({
      rating: { easy: 0.3, useful: 0.3, liked: 0.5, filled_count: 5 },
    });
    expect(passesRatingAndThreshold(c, threshold)).toBe(false);
  });
  it("keeps when easy is below but useful is high", () => {
    const c = makeCourse({
      rating: { easy: 0.2, useful: 0.9, liked: 0.5, filled_count: 5 },
    });
    expect(passesRatingAndThreshold(c, threshold)).toBe(true);
  });
  it("keeps when ratings are null", () => {
    const c = makeCourse({ rating: null });
    expect(passesRatingAndThreshold(c, threshold)).toBe(true);
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
