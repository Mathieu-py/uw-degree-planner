import { UNIT_EPS, unitsMet } from "@/lib/format";

/** A requirement offering `need` interchangeable slots fillable by `eligible` codes. */
export interface MatchBucket {
  need: number;
  /** Course codes that may fill a slot of this bucket. */
  eligible: string[];
}

export interface MatchResult {
  /** Filled-slot count per bucket, index-aligned with the input buckets. */
  filledByBucket: number[];
  /** Every course that was assigned to a slot (each to exactly one). */
  matched: Set<string>;
}

/**
 * Optimal unique assignment of courses to requirement slots via maximum
 * bipartite matching. Each bucket offers `need` interchangeable slots; a course
 * fills at most one slot of any bucket whose `eligible` list contains it.
 *
 * Maximising means overlapping pools never leave a satisfiable requirement
 * spuriously unfilled — a greedy could strand a course in the wrong bucket
 * (give "1 of {A,C}" the A that "2 of {A,B}" needed). One bucket per course, so
 * overlapping pools can't double-count.
 *
 * Kuhn's algorithm: assign each course, augmenting along alternating paths to
 * bump an already-matched course to another open slot. `matchLast` codes are
 * deferred so the matching consumes as few of them as possible.
 */
export function maxBipartiteMatch(
  buckets: readonly MatchBucket[],
  opts: { matchLast?: ReadonlySet<string> } = {},
): MatchResult {
  // Expand buckets into individual slots; `slotBucket[s]` is slot s's bucket.
  const slotBucket: number[] = [];
  for (let bi = 0; bi < buckets.length; bi++)
    for (let k = 0; k < buckets[bi].need; k++) slotBucket.push(bi);

  const bucketEligible = buckets.map((b) => new Set(b.eligible));
  const courseList = [...new Set(buckets.flatMap((b) => b.eligible))];
  // Courses processed earlier win slots (an augmented course never becomes
  // unmatched), so deferring `matchLast` is transversal-matroid greedy: among
  // ALL maximum matchings, the result consumes the fewest deferred codes.
  // Stable sort — insertion order still breaks ties within each class.
  const last = opts.matchLast;
  if (last?.size)
    courseList.sort((a, b) => Number(last.has(a)) - Number(last.has(b)));
  const slotsForCourse = new Map<string, number[]>(
    courseList.map((code) => [
      code,
      slotBucket.flatMap((bi, s) => (bucketEligible[bi].has(code) ? [s] : [])),
    ]),
  );

  const slotMatch: (string | null)[] = new Array(slotBucket.length).fill(null);
  const augment = (code: string, seen: boolean[]): boolean => {
    for (const s of slotsForCourse.get(code) ?? []) {
      if (seen[s]) continue;
      seen[s] = true;
      const cur = slotMatch[s];
      if (cur === null || augment(cur, seen)) {
        slotMatch[s] = code;
        return true;
      }
    }
    return false;
  };

  const matched = new Set<string>();
  for (const code of courseList)
    if (augment(code, new Array(slotBucket.length).fill(false)))
      matched.add(code);

  const filledByBucket = new Array<number>(buckets.length).fill(0);
  for (let s = 0; s < slotBucket.length; s++)
    if (slotMatch[s] !== null) filledByBucket[slotBucket[s]] += 1;

  return { filledByBucket, matched };
}

/** A unit-stated pool: cover `needUnits` of real credit from `eligible` courses. */
export interface UnitPoolInput<Id = number> {
  needUnits: number;
  /** Courses whose weight may credit this pool (opaque ids, weighed by `weightOf`). */
  eligible: Id[];
}

export interface UnitPoolAssignment<Id = number> {
  /** Real units accrued per pool (UNCAPPED), index-aligned to the input pools. */
  got: number[];
  /** Courses actually consumed — each credited to exactly one pool. */
  used: Set<Id>;
  /** true ⇒ shortfall-optimal with minimal consumed weight (up to the >20-item
   *  cover heuristic); false ⇒ a guard or the node budget bailed to
   *  greedy-or-best-found. */
  exact: boolean;
}

function sumWeight<Id>(
  items: Iterable<Id>,
  weightOf: (i: Id) => number,
): number {
  let s = 0;
  for (const i of items) s += weightOf(i);
  return s;
}

/**
 * Route atomic weighted courses to unit pools, lexicographically minimising
 * (total shortfall, total consumed weight): a satisfiable set reaches 100%
 * regardless of pool/course order or unit weight, and heavy courses stay free
 * for the free-elective pool (#121 — the greedy this replaces ignored weight).
 * A course credits its WHOLE weight to one pool; splitting would double-count.
 * Branch-and-bound over contested courses (eligible for ≥2 pools); exclusives
 * fold into pool capacity and are covered minimally at realisation. Greedy
 * seeds the incumbent and is the guard/budget fallback, so results never score
 * worse than the pre-#121 greedy.
 */
export function assignUnitPools<Id>(
  pools: readonly UnitPoolInput<Id>[],
  weightOf: (course: Id) => number,
  guard: { maxContested?: number; nodeBudget?: number } = {},
): UnitPoolAssignment<Id> {
  const { maxContested = 32, nodeBudget = 200_000 } = guard;
  const n = pools.length;
  if (n === 0) return { got: [], used: new Set(), exact: true };

  // Pools each course qualifies for.
  const poolsOfCourse = new Map<Id, number[]>();
  for (let pi = 0; pi < n; pi++)
    for (const c of pools[pi].eligible) {
      const arr = poolsOfCourse.get(c);
      if (arr) arr.push(pi);
      else poolsOfCourse.set(c, [pi]);
    }

  // Single-pool courses fold into `exclusiveWeight` (their pool absorbs what it
  // needs later); contested courses (≥2 pools) are what the search routes.
  const exclusiveOf: Id[][] = Array.from({ length: n }, () => []);
  const contested: Id[] = [];
  const contestedPools: number[][] = [];
  for (const [c, pis] of poolsOfCourse) {
    if (pis.length === 1) exclusiveOf[pis[0]].push(c);
    else {
      contested.push(c);
      contestedPools.push(pis);
    }
  }
  const exclusiveWeight = exclusiveOf.map((cs) => sumWeight(cs, weightOf));

  // Greedy is both the guard fallback and the seed incumbent (search can only
  // improve on it). The guard keys on the contested subproblem, not pool count:
  // disjoint pools cost the search nothing.
  const greedy = greedyAssign(pools, weightOf);
  if (contested.length > maxContested) return greedy;

  // Units each pool needs from contested courses after dumping in its exclusives.
  const slack = pools.map((p, pi) => p.needUnits - exclusiveWeight[pi]);
  const cWeight = contested.map(weightOf);
  // Total contested weight from index i onward, for the optimistic bound.
  const suffixWeight = new Array<number>(contested.length + 1).fill(0);
  for (let i = contested.length - 1; i >= 0; i--)
    suffixWeight[i] = suffixWeight[i + 1] + cWeight[i];

  // Pool pi's shortfall term holding `c` contested units — maintained
  // incrementally through the search (a full recompute per node dominated it).
  const termOf = (pi: number, c: number): number =>
    unitsMet(c, slack[pi]) ? 0 : slack[pi] - c;

  // Minimal exclusive weight closing pool pi's residual over `got` contested
  // units — memoised, the same residuals recur across leaves.
  const coverMemo: Map<number, number>[] = Array.from(
    { length: n },
    () => new Map(),
  );
  const coverCostOf = (pi: number, got: number): number => {
    if (unitsMet(got, pools[pi].needUnits)) return 0;
    const residual = pools[pi].needUnits - got;
    let cost = coverMemo[pi].get(residual);
    if (cost === undefined) {
      cost = sumWeight(
        minWeightCover(exclusiveOf[pi], weightOf, residual),
        weightOf,
      );
      coverMemo[pi].set(residual, cost);
    }
    return cost;
  };

  const cur = new Array<number>(n).fill(0);
  const assign = new Array<number>(contested.length).fill(-1);
  let bestShort = pools.reduce(
    (s, p, pi) => s + Math.max(0, p.needUnits - greedy.got[pi]),
    0,
  );
  // The tiebreak compares REALISED consumption on both sides — contested
  // routing plus each pool's minimal exclusive cover (greedy.used already
  // includes its exclusives) — so a "win" can never realise heavier than
  // greedy.
  let bestConsumed = sumWeight(greedy.used, weightOf);
  let bestAssign: number[] | null = null; // set only when a leaf beats greedy
  let nodes = 0;
  let budgetHit = false;

  // Lexicographic objective: strictly less shortfall, or equal shortfall for
  // strictly less consumed weight — eps-tolerant on both, so float noise can't
  // flip tied optima; ties keep the incumbent, so greedy survives unless
  // genuinely beaten.
  const beats = (short: number, consumed: number): boolean =>
    short < bestShort - UNIT_EPS ||
    (Math.abs(short - bestShort) <= UNIT_EPS &&
      consumed < bestConsumed - UNIT_EPS);

  const search = (i: number, consumed: number, short: number): void => {
    if (budgetHit) return;
    if (++nodes > nodeBudget) {
      budgetHit = true;
      return;
    }
    // Remaining contested weight caps how much more shortfall can shrink, and
    // realised consumption can only exceed the contested weight spent so far —
    // prune unless that optimistic score beats the incumbent.
    if (!beats(Math.max(0, short - suffixWeight[i]), consumed)) return;
    if (i === contested.length) {
      let realised = consumed;
      for (let pi = 0; pi < n; pi++) realised += coverCostOf(pi, cur[pi]);
      if (!beats(short, realised)) return;
      bestShort = Math.min(bestShort, short); // never ratchet upward on a tie
      bestConsumed = realised;
      bestAssign = assign.slice();
      return;
    }
    // Try each eligible pool, then unused — a course that helps no deficit
    // stays free. No met-pool skip: extra contested credit can shrink a pool's
    // exclusive cover by MORE than the course's weight, so it isn't dominated.
    for (const pi of contestedPools[i]) {
      const before = termOf(pi, cur[pi]);
      cur[pi] += cWeight[i];
      assign[i] = pi;
      search(
        i + 1,
        consumed + cWeight[i],
        short + termOf(pi, cur[pi]) - before,
      );
      cur[pi] -= cWeight[i];
    }
    assign[i] = -1;
    search(i + 1, consumed, short);
  };
  let rootShort = 0;
  for (let pi = 0; pi < n; pi++) rootShort += termOf(pi, 0);
  search(0, 0, rootShort);

  // Nothing beat greedy (optimal, or budget exhausted) → keep it.
  if (bestAssign === null) return { ...greedy, exact: !budgetHit };
  const winner: number[] = bestAssign;

  // Realise the winning contested routing, then cover each pool's residual need
  // from its exclusives with the least weight (heavy courses stay free).
  const got = new Array<number>(n).fill(0);
  const used = new Set<Id>();
  for (let i = 0; i < contested.length; i++)
    if (winner[i] >= 0) {
      got[winner[i]] += cWeight[i];
      used.add(contested[i]);
    }
  for (let pi = 0; pi < n; pi++) {
    if (unitsMet(got[pi], pools[pi].needUnits)) continue;
    const residual = pools[pi].needUnits - got[pi];
    for (const c of minWeightCover(exclusiveOf[pi], weightOf, residual)) {
      got[pi] += weightOf(c);
      used.add(c);
    }
  }
  return { got, used, exact: !budgetHit };
}

/**
 * Smallest-total-weight subset of `items` summing to ≥ `target`; all of them if
 * none reaches it. Exact for small sets; lightest-first past a cap (only the
 * tiebreak degrades — feasibility never depends on which exclusives a pool
 * uses, and light-first keeps heavy courses free, same as the exact branch).
 */
function minWeightCover<Id>(
  items: readonly Id[],
  weightOf: (i: Id) => number,
  target: number,
): Id[] {
  if (items.length === 0 || target <= UNIT_EPS) return [];
  const sorted = [...items].sort((a, b) => weightOf(b) - weightOf(a));
  const w = sorted.map(weightOf);
  const total = w.reduce((s, x) => s + x, 0);
  if (total <= target + UNIT_EPS) return sorted; // need every one
  if (sorted.length > 20) {
    const out: Id[] = [];
    let sum = 0;
    for (let k = sorted.length - 1; k >= 0 && !unitsMet(sum, target); k--) {
      out.push(sorted[k]);
      sum += w[k];
    }
    return out;
  }
  // suffix[k] = weight of sorted[k..], for the feasibility prune.
  const suffix = new Array<number>(sorted.length + 1).fill(0);
  for (let k = sorted.length - 1; k >= 0; k--) suffix[k] = suffix[k + 1] + w[k];
  let best: Id[] = sorted;
  let bestW = total;
  const chosen: Id[] = [];
  const rec = (idx: number, sum: number, wsum: number): void => {
    if (wsum >= bestW - UNIT_EPS) return; // can't beat the incumbent
    if (unitsMet(sum, target)) {
      best = [...chosen];
      bestW = wsum;
      return;
    }
    // Even taking everything left can't reach the target → dead branch.
    if (idx === sorted.length || !unitsMet(sum + suffix[idx], target)) return;
    chosen.push(sorted[idx]);
    rec(idx + 1, sum + w[idx], wsum + w[idx]);
    chosen.pop();
    rec(idx + 1, sum, wsum);
  };
  rec(0, 0, 0);
  return best;
}

/** The pre-#121 greedy (most-constrained pool first, consume in order until met):
 *  the incumbent seed and guard fallback, so a pathological plan is never worse. */
function greedyAssign<Id>(
  pools: readonly UnitPoolInput<Id>[],
  weightOf: (i: Id) => number,
): UnitPoolAssignment<Id> {
  const got = new Array<number>(pools.length).fill(0);
  const used = new Set<Id>();
  // Nothing is consumed before the sort, so "most constrained" = fewest eligible.
  const order = pools
    .map((_, i) => i)
    .sort((a, b) => pools[a].eligible.length - pools[b].eligible.length);
  for (const pi of order)
    for (const c of pools[pi].eligible) {
      if (unitsMet(got[pi], pools[pi].needUnits)) break;
      if (used.has(c)) continue;
      used.add(c);
      got[pi] += weightOf(c);
    }
  return { got, used, exact: false };
}
