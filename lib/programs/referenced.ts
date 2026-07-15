import {
  type Program,
  programRuleRoots,
  type RuleNode,
  type Specialization,
  walkRule,
} from "./index";

// Explicit codes a rule tree names (lowercased). `subjectPool` matches by
// prefix/level and `excluded` is forbidden-not-referenced, so both are skipped.
function collectReferenced(root: RuleNode, out: Set<string>): void {
  walkRule(root, (n) => {
    if (n.kind === "courses") {
      for (const c of n.courses) out.add(c.toLowerCase());
    }
  });
}

// Every code a resolved program (+ optional selected spec) references,
// lowercased — broader than getRequiredCourses (adds choice options + elective
// pools). Pure over a passed-in Program, so it runs on the server (full
// registry) or the client (a lazily-loaded detail object) alike. Lets
// eligibility drop a stale restriction a program's own courses would violate.
export function referencedCodesOf(
  program: Program,
  spec?: Specialization | null,
): Set<string> {
  const out = new Set<string>();
  for (const root of programRuleRoots(program)) collectReferenced(root, out);
  for (const e of program.electives ?? []) {
    for (const c of e.approvedCourses ?? []) out.add(c.toLowerCase());
  }
  if (spec?.rules) collectReferenced(spec.rules, out);
  for (const e of spec?.electives ?? []) {
    for (const c of e.approvedCourses ?? []) out.add(c.toLowerCase());
  }
  return out;
}

const EMPTY: ReadonlySet<string> = new Set();

export interface ReferencedCodesLookup {
  (id: string | null | undefined, specId?: string | null): ReadonlySet<string>;
  /** Drop a program's memo entries — call when its Program object is replaced. */
  invalidate(id: string): void;
}

/**
 * Memoized referenced-codes lookup over a Program resolver. One implementation
 * for both the server registry and the client detail cache, so the key scheme
 * and spec resolution can't drift. `cacheMisses` pins the empty set for ids the
 * resolver can't supply — right for the immutable registry, wrong for the
 * client cache, where a miss means "not fetched yet" and must recompute.
 */
export function memoizedReferencedCodes(
  resolve: (id: string) => Program | undefined,
  opts: { cacheMisses: boolean },
): ReferencedCodesLookup {
  const memo = new Map<string, ReadonlySet<string>>();
  const lookup = ((id, specId) => {
    if (!id) return EMPTY;
    const key = `${id}::${specId ?? ""}`;
    const hit = memo.get(key);
    if (hit) return hit;
    const program = resolve(id);
    if (!program) {
      if (opts.cacheMisses) memo.set(key, EMPTY);
      return EMPTY;
    }
    const spec = specId
      ? (program.specializations?.find((s) => s.slug === specId) ?? null)
      : null;
    const out = referencedCodesOf(program, spec);
    memo.set(key, out);
    return out;
  }) as ReferencedCodesLookup;
  lookup.invalidate = (id) => {
    for (const key of memo.keys()) {
      if (key.startsWith(`${id}::`)) memo.delete(key);
    }
  };
  return lookup;
}
