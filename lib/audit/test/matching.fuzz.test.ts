import { describe, expect, it } from "vitest";
import { UNIT_EPS } from "../../format";
import {
  assignUnitPools,
  type MatchBucket,
  maxBipartiteMatch,
  type UnitPoolInput,
} from "../matching";
import { int, lcg, pick, type Rand, shuffle } from "./fuzzRand";

/**
 * Differential fuzz: hand-picked cases only catch bugs someone anticipated.
 * Here random small instances are checked against an exhaustive brute-force
 * oracle over BOTH objective dimensions — total shortfall, then consumed
 * weight — so a routing bug in either shows up as a score mismatch. Instances
 * stay under every guard, so `assignUnitPools` owes an exact answer.
 */

const WEIGHTS = [0.25, 0.5, 1.0] as const;

/** ≤4 pools × ≤6 courses: within guards, and the oracle stays affordable. */
function randomPools(rand: Rand) {
  const weights = Array.from({ length: int(rand, 1, 6) }, () =>
    pick(rand, WEIGHTS),
  );
  const pools: UnitPoolInput[] = Array.from(
    { length: int(rand, 1, 4) },
    () => ({
      needUnits: int(rand, 1, 8) * 0.25,
      eligible: weights.flatMap((_, c) => (rand() < 0.5 ? [c] : [])),
    }),
  );
  return { pools, weightOf: (i: number) => weights[i] };
}

const totalShortfall = (
  pools: readonly UnitPoolInput[],
  got: readonly number[],
) => pools.reduce((s, p, i) => s + Math.max(0, p.needUnits - got[i]), 0);

const consumedWeight = (
  used: Iterable<number>,
  weightOf: (i: number) => number,
) => {
  let s = 0;
  for (const c of used) s += weightOf(c);
  return s;
};

/** Exhaustive lexicographic optimum (min shortfall, then min consumed weight):
 *  every course tries each eligible pool, or stays unused. */
function bruteBest(
  pools: readonly UnitPoolInput[],
  weightOf: (i: number) => number,
): { short: number; consumed: number } {
  const courses = [...new Set(pools.flatMap((p) => p.eligible))];
  const poolsOf = courses.map((c) =>
    pools.flatMap((p, pi) => (p.eligible.includes(c) ? [pi] : [])),
  );
  const got = new Array<number>(pools.length).fill(0);
  let best = { short: Infinity, consumed: Infinity };
  const rec = (i: number, consumed: number): void => {
    if (i === courses.length) {
      const short = totalShortfall(pools, got);
      if (
        short < best.short - UNIT_EPS ||
        (Math.abs(short - best.short) <= UNIT_EPS && consumed < best.consumed)
      )
        best = { short, consumed };
      return;
    }
    for (const pi of poolsOf[i]) {
      got[pi] += weightOf(courses[i]);
      rec(i + 1, consumed + weightOf(courses[i]));
      got[pi] -= weightOf(courses[i]);
    }
    rec(i + 1, consumed); // unused
  };
  rec(0, 0);
  return best;
}

describe("assignUnitPools — differential fuzz vs brute force", () => {
  it("achieves the brute-force optimum (shortfall AND consumed) on 300 instances", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rand = lcg(seed * 2654435761);
      const { pools, weightOf } = randomPools(rand);
      const r = assignUnitPools(pools, weightOf);
      expect(r.exact, `seed ${seed}: small instance must solve exactly`).toBe(
        true,
      );
      const best = bruteBest(pools, weightOf);
      expect(
        totalShortfall(pools, r.got),
        `seed ${seed}: shortfall ${JSON.stringify(pools)}`,
      ).toBeCloseTo(best.short, 9);
      expect(
        consumedWeight(r.used, weightOf),
        `seed ${seed}: consumed ${JSON.stringify(pools)}`,
      ).toBeCloseTo(best.consumed, 9);
    }
  });

  it("keeps its books straight (used ↔ got consistency) on 300 instances", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rand = lcg(seed * 40503 + 7);
      const { pools, weightOf } = randomPools(rand);
      const r = assignUnitPools(pools, weightOf);
      const eligible = new Set(pools.flatMap((p) => p.eligible));
      for (const c of r.used)
        expect(eligible.has(c), `seed ${seed}: used ineligible course`).toBe(
          true,
        );
      const gotSum = r.got.reduce((s, g) => s + g, 0);
      expect(
        gotSum,
        `seed ${seed}: credited units ≠ consumed weight`,
      ).toBeCloseTo(consumedWeight(r.used, weightOf), 9);
    }
  });

  it("shortfall and consumed totals are invariant under pool/eligible order", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const rand = lcg(seed * 69069 + 1);
      const { pools, weightOf } = randomPools(rand);
      const shuffled = shuffle(rand, pools).map((p) => ({
        ...p,
        eligible: shuffle(rand, p.eligible),
      }));
      const a = assignUnitPools(pools, weightOf);
      const b = assignUnitPools(shuffled, weightOf);
      // Only the TOTALS are order-free: distinct optima can meet different
      // pool subsets at the same totals (a 0.25 into "need 0.25" vs "need 0.5").
      expect(totalShortfall(shuffled, b.got), `seed ${seed}`).toBeCloseTo(
        totalShortfall(pools, a.got),
        9,
      );
      expect(
        consumedWeight(b.used, weightOf),
        `seed ${seed}: consumed`,
      ).toBeCloseTo(consumedWeight(a.used, weightOf), 9);
    }
  });
});

/** ≤4 buckets × need ≤2, ≤5 courses — the oracle enumerates every assignment. */
function randomBuckets(rand: Rand): MatchBucket[] {
  const universe = ["a", "b", "c", "d", "e"].slice(0, int(rand, 1, 5));
  return Array.from({ length: int(rand, 1, 4) }, () => ({
    need: int(rand, 1, 2),
    eligible: universe.filter(() => rand() < 0.5),
  }));
}

/** Exhaustive maximum matching size (each course → one open slot or unmatched). */
function bruteMaxMatched(buckets: readonly MatchBucket[]): number {
  const codes = [...new Set(buckets.flatMap((b) => b.eligible))];
  const cap = buckets.map((b) => b.need);
  const rec = (i: number): number => {
    if (i === codes.length) return 0;
    let best = rec(i + 1); // leave unmatched
    for (let bi = 0; bi < buckets.length; bi++)
      if (cap[bi] > 0 && buckets[bi].eligible.includes(codes[i])) {
        cap[bi]--;
        best = Math.max(best, 1 + rec(i + 1));
        cap[bi]++;
      }
    return best;
  };
  return rec(0);
}

describe("maxBipartiteMatch — differential fuzz vs brute force", () => {
  it("matches the brute-force maximum on 200 random instances", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rand = lcg(seed * 22695477 + 3);
      const buckets = randomBuckets(rand);
      const r = maxBipartiteMatch(buckets);
      expect(r.matched.size, `seed ${seed}: ${JSON.stringify(buckets)}`).toBe(
        bruteMaxMatched(buckets),
      );
      const filled = r.filledByBucket.reduce((s, n) => s + n, 0);
      expect(filled, `seed ${seed}: filled ≠ matched`).toBe(r.matched.size);
      r.filledByBucket.forEach((f, i) => {
        expect(f, `seed ${seed}: bucket ${i} overfilled`).toBeLessThanOrEqual(
          buckets[i].need,
        );
      });
    }
  });
});

describe("assignUnitPools — stress", () => {
  // Runaway protection is vitest's per-test timeout; wall-clock assertions were
  // flake bait on a loaded runner. The node budget is the real cap.
  it("guard-trips at scale (40 pools, 400 courses) and stays consistent", () => {
    const rand = lcg(0xbeef);
    const pools: UnitPoolInput[] = Array.from({ length: 40 }, () => ({
      needUnits: 1.0,
      eligible: [] as number[],
    }));
    const weights: number[] = [];
    for (let c = 0; c < 400; c++) {
      weights.push(pick(rand, WEIGHTS));
      for (const pi of new Set([
        int(rand, 0, 39),
        int(rand, 0, 39),
        int(rand, 0, 39),
      ]))
        pools[pi].eligible.push(c);
    }
    const r = assignUnitPools(pools, (i) => weights[i]);
    expect(r.exact).toBe(false); // ~400 contested > maxContested ⇒ greedy
    const gotSum = r.got.reduce((s, g) => s + g, 0);
    expect(gotSum).toBeCloseTo(
      consumedWeight(r.used, (i) => weights[i]),
      9,
    );
  });

  it("a worst-case exact search is capped by the node budget", () => {
    // 32 contested courses — the largest overlap the guard admits. The raw
    // tree is ~3^32 nodes; the budget must cut the search off and still
    // return a valid (greedy-or-better) assignment.
    const pools: UnitPoolInput[] = Array.from({ length: 8 }, () => ({
      needUnits: 2.0,
      eligible: [] as number[],
    }));
    for (let c = 0; c < 32; c++) {
      pools[c % 8].eligible.push(c);
      pools[(c + 1) % 8].eligible.push(c);
    }
    const weightOf = (i: number) => WEIGHTS[i % 3];
    const r = assignUnitPools(pools, weightOf);
    const gotSum = r.got.reduce((s, g) => s + g, 0);
    expect(gotSum).toBeCloseTo(consumedWeight(r.used, weightOf), 9);
  });

  it("covers a large all-exclusive pool via the >20-item cover fallback", () => {
    // 60 quarter-unit courses, need 12.75 → exactly 51 consumed; the other 9
    // stay free for the free-elective remainder.
    const pools: UnitPoolInput[] = [
      { needUnits: 12.75, eligible: Array.from({ length: 60 }, (_, i) => i) },
    ];
    const r = assignUnitPools(pools, () => 0.25);
    expect(r.exact).toBe(true);
    expect(r.got[0]).toBeCloseTo(12.75, 9);
    expect(r.used.size).toBe(51);
  });

  it(">20-item cover fallback goes lightest-first (heavy courses stay free)", () => {
    // Regression: the fallback once walked heaviest-first, burning a 1.0-unit
    // course on a 0.5 residual that two 0.25s cover exactly.
    const pools: UnitPoolInput[] = [
      { needUnits: 0.5, eligible: Array.from({ length: 21 }, (_, i) => i) },
    ];
    const r = assignUnitPools(pools, (i) => (i === 0 ? 1.0 : 0.25));
    expect(r.used.has(0)).toBe(false); // the 1.0 stays free
    expect(r.got[0]).toBeCloseTo(0.5, 9);
  });
});
