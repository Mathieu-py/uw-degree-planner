import { describe, expect, it } from "vitest";
import { unitsMet } from "../../format";
import {
  assignUnitPools,
  maxBipartiteMatch,
  type UnitPoolInput,
} from "../matching";

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
      codesByBucket: [],
      matched: new Set(),
    });
    const r = maxBipartiteMatch([{ need: 2, eligible: [] }]);
    expect(r.filledByBucket).toEqual([0]);
    expect(r.matched.size).toBe(0);
  });

  it("matchLast defers named courses so buckets consume alternatives", () => {
    // "1 of {a, b}" with `a` deferred (a unit pool needs it): the bucket must
    // take b in EITHER eligible order, leaving a free for the pool pass.
    for (const eligible of [
      ["a", "b"],
      ["b", "a"],
    ]) {
      const r = maxBipartiteMatch([{ need: 1, eligible }], {
        matchLast: new Set(["a"]),
      });
      expect(r.matched).toEqual(new Set(["b"]));
      expect(r.filledByBucket).toEqual([1]);
    }
  });

  it("matchLast never shrinks the matching (deferred ≠ excluded)", () => {
    // Every option deferred: the slot still fills — cardinality first.
    const r = maxBipartiteMatch([{ need: 1, eligible: ["a", "b"] }], {
      matchLast: new Set(["a", "b"]),
    });
    expect(r.matched.size).toBe(1);
  });

  it("codesByBucket reports each bucket's assigned courses", () => {
    const r = maxBipartiteMatch([
      { need: 1, eligible: ["a"] },
      { need: 2, eligible: ["a", "b", "c"] },
    ]);
    expect(r.codesByBucket[0]).toEqual(["a"]);
    expect([...r.codesByBucket[1]].sort()).toEqual(["b", "c"]);
    // Assignment and counts agree bucket-by-bucket.
    r.filledByBucket.forEach((n, i) => {
      expect(r.codesByBucket[i]).toHaveLength(n);
    });
  });

  it("a tied claim goes to the EARLIER bucket (named before pools)", () => {
    // `a` fits both; only one slot can hold it. Equal ranks keep input order,
    // so the first bucket wins.
    const r = maxBipartiteMatch([
      { need: 1, eligible: ["a"] },
      { need: 1, eligible: ["a"] },
    ]);
    expect(r.codesByBucket).toEqual([["a"], []]);
  });

  it("rank overrides input order for tied claims; results stay input-aligned", () => {
    // The rank-0 bucket claims the shared course even though it comes second.
    const r = maxBipartiteMatch([
      { need: 1, eligible: ["a"], rank: 1 },
      { need: 1, eligible: ["a"], rank: 0 },
    ]);
    expect(r.codesByBucket).toEqual([[], ["a"]]);
    expect(r.filledByBucket).toEqual([0, 1]);
    expect(r.matched).toEqual(new Set(["a"]));
  });

  it("ranks never shrink the matching (priority is a tiebreak, not a filter)", () => {
    // Enough distinct courses for every slot: all fill regardless of ranks.
    const r = maxBipartiteMatch([
      { need: 1, eligible: ["a", "b"], rank: 5 },
      { need: 2, eligible: ["b", "c"], rank: 0 },
      { need: 1, eligible: ["a", "d"], rank: 2 },
    ]);
    expect(r.matched.size).toBe(4);
    expect(r.filledByBucket).toEqual([1, 2, 1]);
  });
});

describe("assignUnitPools", () => {
  // Count pools whose real credit reaches their need.
  const metCount = (pools: readonly UnitPoolInput[], got: number[]) =>
    pools.filter((p, i) => unitsMet(got[i], p.needUnits)).length;

  it("no pools → empty, exact", () => {
    expect(assignUnitPools([], () => 0.5)).toEqual({
      got: [],
      used: new Set(),
      usedByPool: [],
      exact: true,
    });
  });

  it("usedByPool partitions `used` across the pools", () => {
    const pools: UnitPoolInput[] = [
      { needUnits: 0.5, eligible: [0, 1] },
      { needUnits: 1.0, eligible: [1, 2, 3] },
    ];
    const r = assignUnitPools(pools, () => 0.5);
    expect(r.usedByPool).toHaveLength(2);
    // Every consumed course appears in exactly one pool's list, and the lists
    // reproduce `used` and each pool's credited units.
    const flat = r.usedByPool.flat();
    expect(new Set(flat)).toEqual(r.used);
    expect(flat).toHaveLength(r.used.size);
    r.usedByPool.forEach((cs, i) => {
      expect(cs.length * 0.5).toBeCloseTo(r.got[i]);
    });
  });

  it("does NOT split one atomic course across two pools (no false 100%)", () => {
    // One 1.0-unit course eligible for both "0.5 unit CS-or-MATH" and "0.5 unit
    // CS", nothing else. A course credits its WHOLE weight to ONE pool, so it can
    // fill only one of the two — the student genuinely needs a second course.
    // Quarter-slot matching would split it 0.5+0.5 and report both met (false 100%).
    const pools: UnitPoolInput[] = [
      { needUnits: 0.5, eligible: [0] },
      { needUnits: 0.5, eligible: [0] },
    ];
    const r = assignUnitPools(pools, () => 1.0);
    expect(r.used.size).toBe(1); // course not split
    expect(metCount(pools, r.got)).toBe(1); // exactly one pool covered
    const shortfall = pools.reduce(
      (s, p, i) => s + Math.max(0, p.needUnits - r.got[i]),
      0,
    );
    expect(shortfall).toBeCloseTo(0.5);
  });

  it("covers a weighted-tie of 3 pools that greedy would strand, any order", () => {
    // H = 1.0-unit course (index 0); a,b = 0.5 (indices 1,2). Total weight 2.0 =
    // total need 2.0. The one satisfying assignment: H→B, a→A, b→C. A weight-blind
    // greedy lets pool A grab the heavy H (it only needs 0.5), starving B → stuck
    // at 99%. The exact matcher routes H to the pool that needs a whole unit.
    const W = (i: number) => (i === 0 ? 1.0 : 0.5);
    const A: UnitPoolInput = { needUnits: 0.5, eligible: [0, 1] }; // H or a
    const B: UnitPoolInput = { needUnits: 1.0, eligible: [0, 1, 2] }; // H, a, b
    const C: UnitPoolInput = { needUnits: 0.5, eligible: [1, 2] }; // a or b
    for (const pools of [
      [A, B, C],
      [C, B, A],
      [B, A, C],
      // eligible lists reversed too — result must not depend on it
      [
        { ...A, eligible: [1, 0] },
        { ...B, eligible: [2, 1, 0] },
        { ...C, eligible: [2, 1] },
      ],
    ]) {
      const r = assignUnitPools(pools, W);
      expect(r.exact).toBe(true);
      expect(metCount(pools, r.got)).toBe(3); // all three met, order-independent
    }
  });

  it("leaves a heavy course free when lighter ones cover the need", () => {
    // One 0.5-unit pool, exclusive courses {H=1.0, x=0.25, y=0.25}. Covering with
    // the two 0.25s (0.5 exactly) beats burning the 1.0 — which would credit only
    // 0.5 and lock a full-year course out of the free-elective pool.
    const W = (i: number) => (i === 0 ? 1.0 : 0.25);
    const pools: UnitPoolInput[] = [{ needUnits: 0.5, eligible: [0, 1, 2] }];
    const r = assignUnitPools(pools, W);
    expect(r.got[0]).toBeCloseTo(0.5);
    expect(r.used.has(0)).toBe(false); // the 1.0-unit course stays free
    expect(r.used).toEqual(new Set([1, 2]));
  });

  it("falls back to greedy past the size guard, still valid", () => {
    // Force the guard (maxContested 1) with 2 contested courses; the result is the
    // ported greedy — flagged exact:false but never a throw, both pools still met.
    const pools: UnitPoolInput[] = [
      { needUnits: 0.5, eligible: [0, 1] },
      { needUnits: 0.5, eligible: [0, 1] },
    ];
    const r = assignUnitPools(pools, () => 0.5, { maxContested: 1 });
    expect(r.exact).toBe(false);
    expect(metCount(pools, r.got)).toBe(2);
    expect(r.used.size).toBe(2);
  });

  it("credits a 1.0 course fully and keeps surplus courses free", () => {
    // Single "1.0 unit" pool, one 1.0 course + a spare 0.5: the pool is met by the
    // heavy course alone and the 0.5 stays free (not consumed into a met pool).
    const W = (i: number) => (i === 0 ? 1.0 : 0.5);
    const pools: UnitPoolInput[] = [{ needUnits: 1.0, eligible: [0, 1] }];
    const r = assignUnitPools(pools, W);
    expect(unitsMet(r.got[0], 1.0)).toBe(true);
    expect(r.used).toEqual(new Set([0]));
  });

  it("never realises heavier than greedy (consumed measured end-to-end)", () => {
    // Regression: the tiebreak once compared a leaf's CONTESTED-only weight
    // against greedy's total, so "c unused" (contested 0) beat greedy and then
    // realised {H,b} = 1.5 units — heavier than greedy's {c,b} = 1.0, burning
    // the full-year H. Both sides must measure realised consumption.
    const W = (i: number) => (i === 1 ? 1.0 : 0.5); // c=0(0.5) H=1(1.0) b=2(0.5)
    const pools: UnitPoolInput[] = [
      { needUnits: 0.5, eligible: [0, 1] }, // c (contested) or H (exclusive)
      { needUnits: 0.5, eligible: [0, 2] }, // c (contested) or b (exclusive)
    ];
    const r = assignUnitPools(pools, W);
    expect(metCount(pools, r.got)).toBe(2);
    expect(r.used).toEqual(new Set([0, 2])); // c and b; the 1.0-unit H stays free
  });

  it("solves an overlapping cluster exactly regardless of total pool count", () => {
    // Regression: the guard once keyed on TOTAL pool count (>8 ⇒ greedy), so
    // disjoint pools around a tiny weighted-tie cluster silently reintroduced
    // the stranding. The guard now keys on the contested subproblem only.
    const W = (i: number) => (i === 100 ? 1.0 : 0.5);
    const disjoint: UnitPoolInput[] = Array.from({ length: 7 }, (_, k) => ({
      needUnits: 0.5,
      eligible: [k], // its own exclusive 0.5 course
    }));
    const cluster: UnitPoolInput[] = [
      { needUnits: 0.5, eligible: [100, 101] },
      { needUnits: 1.0, eligible: [100, 101, 102] },
      { needUnits: 0.5, eligible: [101, 102] },
    ];
    const pools = [...disjoint, ...cluster];
    const r = assignUnitPools(pools, W);
    expect(r.exact).toBe(true);
    expect(metCount(pools, r.got)).toBe(10); // all met — no guard fallback
  });

  it("returns greedy quality when the node budget dies immediately", () => {
    // The weighted-tie instance with nodeBudget 1: the search aborts on its
    // first expansion, so the result must be the greedy incumbent — 2 of 3
    // pools met, exact:false, never a throw. Pins the "budget bail is never
    // worse than earlier" floor.
    const W = (i: number) => (i === 0 ? 1.0 : 0.5);
    const pools: UnitPoolInput[] = [
      { needUnits: 0.5, eligible: [0, 1] },
      { needUnits: 1.0, eligible: [0, 1, 2] },
      { needUnits: 0.5, eligible: [1, 2] },
    ];
    const r = assignUnitPools(pools, W, { nodeBudget: 1 });
    expect(r.exact).toBe(false);
    expect(metCount(pools, r.got)).toBe(2);
  });

  it("prefers the lighter zero-shortfall routing among contested courses", () => {
    // Both pools coverable two ways; consuming the two 0.5s beats burning the
    // 1.0 (the consumed-weight tiebreak, on the contested path this time — the
    // exclusive path is covered by the minWeightCover test above).
    const W = (i: number) => (i === 0 ? 1.0 : 0.5);
    const pools: UnitPoolInput[] = [
      { needUnits: 0.5, eligible: [0, 1, 2] },
      { needUnits: 0.5, eligible: [0, 1, 2] },
    ];
    const r = assignUnitPools(pools, W);
    expect(metCount(pools, r.got)).toBe(2);
    expect(r.used).toEqual(new Set([1, 2])); // the 1.0 stays free
  });

  it("credits what it can on an infeasible pool and reports the true gap", () => {
    const pools: UnitPoolInput[] = [{ needUnits: 2.0, eligible: [0] }];
    const r = assignUnitPools(pools, () => 0.5);
    expect(r.exact).toBe(true);
    expect(r.got[0]).toBeCloseTo(0.5);
    expect(r.used).toEqual(new Set([0]));
  });

  it("a zero-need pool consumes nothing, even sharing its only course", () => {
    const pools: UnitPoolInput[] = [
      { needUnits: 0, eligible: [0] },
      { needUnits: 0.5, eligible: [0] },
    ];
    const r = assignUnitPools(pools, () => 0.5);
    expect(r.got[0]).toBe(0);
    expect(r.got[1]).toBeCloseTo(0.5);
    expect(r.used).toEqual(new Set([0]));
  });

  it("meets a pool despite float drift in summed weights (UNIT_EPS)", () => {
    // 3 × 0.35 sums to 1.0499999999999998 < 1.05 in floats; the tolerance must
    // still call the pool met. Weights off the exactly-representable quarter
    // grid are the case the epsilon exists for.
    const pools: UnitPoolInput[] = [{ needUnits: 1.05, eligible: [0, 1, 2] }];
    const r = assignUnitPools(pools, () => 0.35);
    expect(r.used.size).toBe(3);
    expect(unitsMet(r.got[0], 1.05)).toBe(true);
  });
});
