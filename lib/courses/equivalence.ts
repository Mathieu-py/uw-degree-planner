/**
 * Course equivalence (GitHub #21). Two UW courses with different codes can be
 * the *same course* — cross-listed under another subject. UW's authoritative
 * source is Kuali's `crossListedCourses` field, captured per course as
 * {@link Course.crossListed} in the committed snapshot.
 *
 * This builds the symmetric, transitive closure of those pairwise links into
 * equivalence classes (union-find), so any member of a class satisfies a
 * requirement, prereq, or placement that names another member.
 *
 * The index is consulted for SATISFACTION LOOKUPS ONLY — "does a placed/completed
 * course count for this code?". It must never inject synthetic placements or sum
 * a course's units twice; unit totals always flow from real placed codes.
 *
 * All codes are lowercase (the catalog, the AST, and plan Sets are all
 * lowercase). Callers passing raw-case codes will silently miss.
 */

export interface EquivalenceIndex {
  /** Every code equivalent to `code`, including itself. Singleton → just `[code]`. */
  classOf(code: string): readonly string[];
  /** True if `a` and `b` are the same course (equal, or cross-listed equivalents). */
  areEquivalent(a: string, b: string): boolean;
  /**
   * Expand a set of codes to also include every equivalent of each member. Used
   * to widen completed/placed sets so an equivalent satisfies an exact-code check.
   */
  expand(codes: Iterable<string>): Set<string>;
}

/**
 * Build an equivalence index from pairwise cross-listing links. Each pair unions
 * the two codes; the closure groups transitively-linked codes into one class.
 */
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

  // Materialize classes once. The canonical of a class is its min code, for a
  // stable representative independent of union order.
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

/**
 * A no-op index (no course is equivalent to any other). The default wherever an
 * equivalence index is optional, so callers without a catalog keep exact-code
 * behavior unchanged.
 */
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
 * The equivalence index for a catalog, memoized on the container's identity.
 * The catalog (a `Course[]` from `loadTerm`, or a `code → Course` map) is a
 * stable reference within a render, so the union-find runs once per catalog
 * rather than per keystroke. Accepts either an array or a Map.
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
