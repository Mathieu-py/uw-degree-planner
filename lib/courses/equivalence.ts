/**
 * Course equivalence (GitHub #21): cross-listed courses are the *same course*
 * under different codes. Authoritative source is Kuali's `crossListedCourses`
 * ({@link Course.crossListed}). Builds the transitive closure (union-find) into
 * equivalence classes, so any member satisfies a requirement naming another.
 *
 * Satisfaction lookups ONLY — never injects synthetic placements or double-counts
 * units; unit totals flow from real placed codes. Lowercase codes only (raw-case
 * silently misses).
 */

export interface EquivalenceIndex {
  /** Every code equivalent to `code`, including itself. Singleton → just `[code]`. */
  classOf(code: string): readonly string[];
  /** True if `a` and `b` are the same course (equal, or cross-listed equivalents). */
  areEquivalent(a: string, b: string): boolean;
  /** Widen a code set to include every equivalent, so equivalents satisfy exact-code checks. */
  expand(codes: Iterable<string>): Set<string>;
}

/** Build an equivalence index from pairwise cross-listing links via union-find. */
function buildEquivalenceIndex(
  pairs: Iterable<readonly [string, string]>,
): EquivalenceIndex {
  const parent = new Map<string, string>();

  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== undefined && parent.get(root) !== root) {
      root = parent.get(root) as string;
    }
    // Path-compress so repeated lookups stay near-constant.
    let cur = x;
    while (parent.get(cur) !== undefined && parent.get(cur) !== cur) {
      const next = parent.get(cur) as string;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };

  const union = (a: string, b: string) => {
    if (parent.get(a) === undefined) parent.set(a, a);
    if (parent.get(b) === undefined) parent.set(b, b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const [a, b] of pairs) {
    if (a && b && a !== b) union(a, b);
  }

  // Materialize classes once; canonical = min code (stable, union-order independent).
  const classes = new Map<string, string[]>();
  for (const code of parent.keys()) {
    const root = find(code);
    const list = classes.get(root) ?? [];
    list.push(code);
    classes.set(root, list);
  }
  const canonicalOf = new Map<string, string>();
  const membersOf = new Map<string, readonly string[]>();
  for (const list of classes.values()) {
    const sorted = [...list].sort();
    const canon = sorted[0];
    for (const code of sorted) {
      canonicalOf.set(code, canon);
      membersOf.set(code, sorted);
    }
  }

  return {
    classOf: (code) => membersOf.get(code) ?? [code],
    areEquivalent: (a, b) => {
      if (a === b) return true;
      const ca = canonicalOf.get(a);
      const cb = canonicalOf.get(b);
      return ca !== undefined && ca === cb;
    },
    expand: (codes) => {
      const out = new Set<string>();
      for (const code of codes) {
        out.add(code);
        const members = membersOf.get(code);
        if (members) for (const m of members) out.add(m);
      }
      return out;
    },
  };
}

/** No-op index (no equivalences). Default when none supplied — preserves exact-code behavior. */
export const EMPTY_EQUIVALENCE: EquivalenceIndex = buildEquivalenceIndex([]);

interface CrossListedCourse {
  code: string;
  crossListed?: string[];
}

/** Build an equivalence index from a catalog's `crossListed` links. */
function buildEquivalenceFromCourses(
  courses: Iterable<CrossListedCourse>,
): EquivalenceIndex {
  const pairs: Array<[string, string]> = [];
  for (const c of courses) {
    if (!c.crossListed) continue;
    for (const other of c.crossListed) pairs.push([c.code, other]);
  }
  return buildEquivalenceIndex(pairs);
}

const catalogIndexCache = new WeakMap<object, EquivalenceIndex>();

/**
 * Equivalence index for a catalog (array or Map), memoized on container identity
 * so union-find runs once per catalog rather than per keystroke.
 */
export function equivalenceForCatalog(
  catalog:
    | ReadonlyArray<CrossListedCourse>
    | ReadonlyMap<string, CrossListedCourse>,
): EquivalenceIndex {
  const cached = catalogIndexCache.get(catalog);
  if (cached) return cached;
  const courses = Array.isArray(catalog)
    ? (catalog as ReadonlyArray<CrossListedCourse>)
    : (catalog as ReadonlyMap<string, CrossListedCourse>).values();
  const index = buildEquivalenceFromCourses(courses);
  catalogIndexCache.set(catalog, index);
  return index;
}
