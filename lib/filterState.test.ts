import { describe, expect, it } from "vitest";
import { DEFAULT_FILTER_STATE, decodeFilterState, encodeFilterState } from "./filterState";
import type { FilterState } from "./types";

function roundTrip(state: FilterState): FilterState {
  return decodeFilterState(new URLSearchParams(encodeFilterState(state).toString()));
}

describe("decodeFilterState", () => {
  it("returns the default state for an empty URLSearchParams", () => {
    const decoded = decodeFilterState(new URLSearchParams());
    expect(decoded).toEqual(DEFAULT_FILTER_STATE);
  });

  it("returns the default state for an empty record", () => {
    expect(decodeFilterState({})).toEqual(DEFAULT_FILTER_STATE);
  });

  it("accepts Next.js-style searchParams records", () => {
    const state = decodeFilterState({ exc: "PHIL,ENGL", minU: "0.6", done: "math115,cs115" });
    expect(state.excludePrefixes).toEqual(["PHIL", "ENGL"]);
    expect(state.minUseful).toBe(0.6);
    expect(state.completedCourses).toEqual(["math115", "cs115"]);
  });

  it("normalises prefix casing to upper and course codes to lower", () => {
    const state = decodeFilterState(new URLSearchParams("exc=phil,engl&done=MATH115,CS115"));
    expect(state.excludePrefixes).toEqual(["PHIL", "ENGL"]);
    expect(state.completedCourses).toEqual(["math115", "cs115"]);
  });

  it("parses levels as integers", () => {
    const state = decodeFilterState(new URLSearchParams("lv=100,200,400"));
    expect(state.levels).toEqual([100, 200, 400]);
  });

  it("dedupes list values", () => {
    const state = decodeFilterState(
      new URLSearchParams("lv=100,100,200&exc=PHIL,PHIL,ENGL&done=cs115,cs115"),
    );
    expect(state.levels).toEqual([100, 200]);
    expect(state.excludePrefixes).toEqual(["PHIL", "ENGL"]);
    expect(state.completedCourses).toEqual(["cs115"]);
  });

  it("parses the rating-and-threshold pair", () => {
    const state = decodeFilterState(new URLSearchParams("rat=0.4,0.5"));
    expect(state.ratingAndThreshold).toEqual({ easy: 0.4, useful: 0.5 });
  });

  it("ignores malformed rating-and-threshold values", () => {
    const state = decodeFilterState(new URLSearchParams("rat=foo"));
    expect(state.ratingAndThreshold).toBeNull();
  });

  it("decodes booleans from 1, ignores other values", () => {
    expect(decodeFilterState(new URLSearchParams("seats=1")).hasSeatsAvailable).toBe(true);
    expect(decodeFilterState(new URLSearchParams("seats=0")).hasSeatsAvailable).toBe(false);
    expect(decodeFilterState(new URLSearchParams("seats=true")).hasSeatsAvailable).toBe(false);
    expect(decodeFilterState(new URLSearchParams("up=1")).hideUnmetPrereqs).toBe(true);
  });
});

describe("encodeFilterState", () => {
  it("returns an empty URL string for the default state", () => {
    expect(encodeFilterState(DEFAULT_FILTER_STATE).toString()).toBe("");
  });

  it("omits fields that match the default", () => {
    const state: FilterState = { ...DEFAULT_FILTER_STATE, hasSeatsAvailable: true };
    expect(encodeFilterState(state).toString()).toBe("seats=1");
  });

  it("encodes prefix arrays joined by commas", () => {
    const state: FilterState = { ...DEFAULT_FILTER_STATE, excludePrefixes: ["PHIL", "ENGL"] };
    expect(encodeFilterState(state).get("exc")).toBe("PHIL,ENGL");
  });

  it("encodes the rating threshold as easy,useful", () => {
    const state: FilterState = {
      ...DEFAULT_FILTER_STATE,
      ratingAndThreshold: { easy: 0.4, useful: 0.5 },
    };
    expect(encodeFilterState(state).get("rat")).toBe("0.4,0.5");
  });
});

describe("round trip", () => {
  it("preserves the default state", () => {
    expect(roundTrip(DEFAULT_FILTER_STATE)).toEqual(DEFAULT_FILTER_STATE);
  });

  it("preserves a fully-populated state across every URL key", () => {
    const state: FilterState = {
      excludePrefixes: ["PHIL", "ENGL", "ARTS"],
      includePrefixes: ["MATH", "CS"],
      levels: [100, 200, 300],
      hasSeatsAvailable: true,
      completedCourses: ["math116", "math117", "cs115"],
      hideUnmetPrereqs: true,
      ratingAndThreshold: { easy: 0.4, useful: 0.5 },
      minUseful: 0.6,
      minEasy: 0.3,
    };
    expect(roundTrip(state)).toEqual(state);
  });

  it("preserves a mixed user-shaped state", () => {
    const state: FilterState = {
      ...DEFAULT_FILTER_STATE,
      excludePrefixes: ["PHIL", "ENGL"],
      levels: [200, 300],
      minUseful: 0.6,
      hasSeatsAvailable: true,
      completedCourses: ["math115", "cs115"],
    };
    expect(roundTrip(state)).toEqual(state);
  });
});
