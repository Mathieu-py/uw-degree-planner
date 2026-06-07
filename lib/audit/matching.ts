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
 * bump an already-matched course to another open slot.
 */
export function maxBipartiteMatch(
  buckets: readonly MatchBucket[],
): MatchResult {
  // Expand buckets into individual slots; `slotBucket[s]` is slot s's bucket.
  const slotBucket: number[] = [];
  for (let bi = 0; bi < buckets.length; bi++)
    for (let k = 0; k < buckets[bi].need; k++) slotBucket.push(bi);

  const bucketEligible = buckets.map((b) => new Set(b.eligible));
  const courseList = [...new Set(buckets.flatMap((b) => b.eligible))];
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
