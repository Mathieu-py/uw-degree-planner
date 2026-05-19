import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTER_STATE,
  decodeFilterState,
  encodeFilterState,
  mergeFilterStateIntoParams,
} from "../filterState";
import type { FilterState } from "../types";

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

  it("rejects non-integer level tokens", () => {
    const state = decodeFilterState(new URLSearchParams("lv=200x,3.5,100"));
    expect(state.levels).toEqual([100]);
  });

  it("drops level values outside the supported {100,200,300,400} buckets", () => {
    const state = decodeFilterState(new URLSearchParams("lv=50,100,500,250,400"));
    expect(state.levels).toEqual([100, 400]);
  });

  it("clamps minUseful/minEasy above 1 to 1", () => {
    const state = decodeFilterState(new URLSearchParams("minU=2&minE=99"));
    expect(state.minUseful).toBe(1);
    expect(state.minEasy).toBe(1);
  });

  it("treats negative minUseful/minEasy as unset (null)", () => {
    const state = decodeFilterState(new URLSearchParams("minU=-0.5&minE=-1"));
    expect(state.minUseful).toBeNull();
    expect(state.minEasy).toBeNull();
  });

  it("treats non-finite minUseful/minEasy as unset (null)", () => {
    const state = decodeFilterState(new URLSearchParams("minU=NaN&minE=Infinity"));
    expect(state.minUseful).toBeNull();
    expect(state.minEasy).toBeNull();
  });

  it("preserves valid decimal minUseful/minEasy inside (0,1)", () => {
    const state = decodeFilterState(new URLSearchParams("minU=0.42&minE=0.7"));
    expect(state.minUseful).toBe(0.42);
    expect(state.minEasy).toBe(0.7);
  });

  it("dedupes list values", () => {
    const state = decodeFilterState(
      new URLSearchParams("lv=100,100,200&exc=PHIL,PHIL,ENGL&done=cs115,cs115"),
    );
    expect(state.levels).toEqual([100, 200]);
    expect(state.excludePrefixes).toEqual(["PHIL", "ENGL"]);
    expect(state.completedCourses).toEqual(["cs115"]);
  });

  it("decodes booleans from 1, ignores other values", () => {
    expect(decodeFilterState(new URLSearchParams("seats=1")).hasSeatsAvailable).toBe(true);
    expect(decodeFilterState(new URLSearchParams("seats=0")).hasSeatsAvailable).toBe(false);
    expect(decodeFilterState(new URLSearchParams("seats=true")).hasSeatsAvailable).toBe(false);
    expect(decodeFilterState(new URLSearchParams("up=1")).hideUnmetPrereqs).toBe(true);
  });

  it("accepts a known program id and normalises casing", () => {
    expect(decodeFilterState(new URLSearchParams("prog=syde")).programId).toBe("syde");
    expect(decodeFilterState(new URLSearchParams("prog=SYDE")).programId).toBe("syde");
  });

  it("drops unknown program ids to null", () => {
    expect(decodeFilterState(new URLSearchParams("prog=phys")).programId).toBeNull();
    expect(decodeFilterState(new URLSearchParams("prog=")).programId).toBeNull();
  });

  it("accepts a valid term letter and normalises casing", () => {
    expect(decodeFilterState(new URLSearchParams("term=3A")).currentTerm).toBe("3A");
    expect(decodeFilterState(new URLSearchParams("term=3a")).currentTerm).toBe("3A");
  });

  it("drops invalid term values to null", () => {
    expect(decodeFilterState(new URLSearchParams("term=5A")).currentTerm).toBeNull();
    expect(decodeFilterState(new URLSearchParams("term=foo")).currentTerm).toBeNull();
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

});

describe("mergeFilterStateIntoParams", () => {
  it("preserves sort params (s, d) when filters change", () => {
    const current = new URLSearchParams("s=easy&d=asc&exc=PHIL");
    const next: FilterState = { ...DEFAULT_FILTER_STATE, excludePrefixes: ["ENGL"] };
    const merged = mergeFilterStateIntoParams(current, next);
    expect(merged.get("s")).toBe("easy");
    expect(merged.get("d")).toBe("asc");
    expect(merged.get("exc")).toBe("ENGL");
  });

  it("clears filter keys that fall back to default", () => {
    const current = new URLSearchParams("s=easy&exc=PHIL&minU=0.5&seats=1");
    const merged = mergeFilterStateIntoParams(current, DEFAULT_FILTER_STATE);
    expect(merged.get("s")).toBe("easy");
    expect(merged.has("exc")).toBe(false);
    expect(merged.has("minU")).toBe(false);
    expect(merged.has("seats")).toBe(false);
  });

  it("does not mutate the input params", () => {
    const current = new URLSearchParams("s=easy&exc=PHIL");
    const before = current.toString();
    mergeFilterStateIntoParams(current, { ...DEFAULT_FILTER_STATE, excludePrefixes: ["ENGL"] });
    expect(current.toString()).toBe(before);
  });

  it("writes every filter key on a fully-populated state", () => {
    const state: FilterState = {
      excludePrefixes: ["PHIL"],
      includePrefixes: ["MATH"],
      levels: [200],
      hasSeatsAvailable: true,
      completedCourses: ["math116"],
      hideUnmetPrereqs: true,
      minUseful: 0.6,
      minEasy: 0.3,
      programId: "syde",
      currentTerm: "3A",
    };
    const merged = mergeFilterStateIntoParams(new URLSearchParams("s=code"), state);
    expect(merged.get("s")).toBe("code");
    expect(decodeFilterState(merged)).toEqual(state);
  });

  it("clears prog and term when they fall back to null", () => {
    const current = new URLSearchParams("prog=syde&term=3A&exc=PHIL");
    const merged = mergeFilterStateIntoParams(current, DEFAULT_FILTER_STATE);
    expect(merged.has("prog")).toBe(false);
    expect(merged.has("term")).toBe(false);
    expect(merged.has("exc")).toBe(false);
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
      minUseful: 0.6,
      minEasy: 0.3,
      programId: "syde",
      currentTerm: "3A",
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
