import { describe, expect, it } from "vitest";
import { maxBipartiteMatch } from "../matching";

describe("maxBipartiteMatch", () => {
  it("fills a single bucket up to its need", () => {
    const r = maxBipartiteMatch([{ need: 2, eligible: ["a", "b", "c"] }]);
    expect(r.filledByBucket).toEqual([2]);
    expect(r.matched.size).toBe(2);
  });

  it("caps fills at the number of eligible courses", () => {
    const r = maxBipartiteMatch([{ need: 3, eligible: ["a"] }]);
    expect(r.filledByBucket).toEqual([1]);
    expect(r.matched).toEqual(new Set(["a"]));
  });

  it("assigns each course to at most one bucket", () => {
    // Two buckets both eligible for "a"; only one can claim it.
    const r = maxBipartiteMatch([
      { need: 1, eligible: ["a"] },
      { need: 1, eligible: ["a"] },
    ]);
    expect(r.filledByBucket.reduce((s, n) => s + n, 0)).toBe(1);
    expect(r.matched).toEqual(new Set(["a"]));
  });

  it("finds the jointly-satisfiable assignment a greedy would miss", () => {
    // The classic stranding case: bucket0 "1 of {A,C}", bucket1 "2 of {A,B}".
    // A naive greedy could give A to bucket0, leaving bucket1 one short.
    // Maximum matching routes A→bucket1, C→bucket0, B→bucket1 → both full.
    const r = maxBipartiteMatch([
      { need: 1, eligible: ["a", "c"] },
      { need: 2, eligible: ["a", "b"] },
    ]);
    expect(r.filledByBucket).toEqual([1, 2]);
    expect(r.matched).toEqual(new Set(["a", "b", "c"]));
  });

  it("handles empty buckets and no eligibility", () => {
    expect(maxBipartiteMatch([])).toEqual({
      filledByBucket: [],
      matched: new Set(),
    });
    const r = maxBipartiteMatch([{ need: 2, eligible: [] }]);
    expect(r.filledByBucket).toEqual([0]);
    expect(r.matched.size).toBe(0);
  });
});
