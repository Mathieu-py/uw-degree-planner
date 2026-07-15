/**
 * Credit-exclusion / antireq-conflict engine: turns plan validation issues into
 * slot-scoped degree-credit exclusions (and the header's blocking-issue count).
 */

/** The fields the credit-exclusion helpers read off a plan validation issue. */
export interface PlacementIssue {
  slotId: string;
  courseCode: string;
  kind: string;
  /** Antireq only: the placed codes this course conflicts with (lowercased). */
  conflictsWith?: readonly string[];
}

interface ConflictMember {
  code: string;
  slotId: string;
}

/**
 * Group antireq issues into conflict sets — connected components over the
 * symmetric `conflictsWith` edges. Each set lists its placements; used to credit
 * one member per conflict and to count a conflict once.
 */
export function antireqConflictGroups(
  issues: readonly PlacementIssue[],
): ConflictMember[][] {
  // First occurrence wins, mirroring buildPlacementMap (keeps first slot per
  // code; issues arrive in slot order). Must agree, else an exclusion key
  // `slotId::code` could name a slot the placement map never recorded and the
  // legality overlay would silently miss that satisfier.
  const slotOf = new Map<string, string>();
  for (const i of issues) {
    if (
      i.kind === "antireq" &&
      i.courseCode !== "" &&
      !slotOf.has(i.courseCode)
    )
      slotOf.set(i.courseCode, i.slotId);
  }
  const adj = new Map<string, Set<string>>();
  const ensure = (c: string) => {
    let s = adj.get(c);
    if (!s) {
      s = new Set();
      adj.set(c, s);
    }
    return s;
  };
  for (const i of issues) {
    if (i.kind !== "antireq" || !slotOf.has(i.courseCode)) continue;
    for (const other of i.conflictsWith ?? []) {
      if (!slotOf.has(other) || other === i.courseCode) continue;
      ensure(i.courseCode).add(other);
      ensure(other).add(i.courseCode);
    }
  }
  const seen = new Set<string>();
  const groups: ConflictMember[][] = [];
  for (const start of slotOf.keys()) {
    if (seen.has(start)) continue;
    const comp: string[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length > 0) {
      const cur = stack.pop() as string;
      comp.push(cur);
      for (const nb of adj.get(cur) ?? []) {
        if (!seen.has(nb)) {
          seen.add(nb);
          stack.push(nb);
        }
      }
    }
    groups.push(
      comp.map((code) => ({ code, slotId: slotOf.get(code) as string })),
    );
  }
  return groups;
}

/** Pick the member to KEEP: program-referenced > higher units > code ascending. */
function pickKeeper(
  group: ConflictMember[],
  referenced: ReadonlySet<string>,
  unitsOf: (code: string) => number,
): ConflictMember {
  return [...group].sort((a, b) => {
    const ra = referenced.has(a.code) ? 1 : 0;
    const rb = referenced.has(b.code) ? 1 : 0;
    if (ra !== rb) return rb - ra;
    const ua = unitsOf(a.code);
    const ub = unitsOf(b.code);
    if (ua !== ub) return ub - ua;
    return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
  })[0];
}

/**
 * Slot-scoped keys (`slotId::code`) to EXCLUDE from degree credit. Per-program
 * (keeper depends on what the program requires):
 *  - every prereq-misplaced course;
 *  - every antireq conflict member except the keeper — UW grants credit for one
 *    of an antireq pair, never both, never zero.
 * Passed unchanged to {@link compileAudit} / {@link computeDegreeProgress}.
 */
export function creditExclusionKeys(
  issues: readonly PlacementIssue[],
  opts: { referenced: ReadonlySet<string>; unitsOf: (code: string) => number },
): Set<string> {
  const out = new Set<string>();
  for (const i of issues) {
    if (i.courseCode === "") continue; // slot-level (overload) — not a placement
    if (i.kind === "prereq") out.add(`${i.slotId}::${i.courseCode}`);
  }
  for (const group of antireqConflictGroups(issues)) {
    if (group.length <= 1) continue;
    const keeper = pickKeeper(group, opts.referenced, opts.unitsOf);
    for (const m of group) {
      if (m.code === keeper.code && m.slotId === keeper.slotId) continue;
      out.add(`${m.slotId}::${m.code}`);
    }
  }
  return out;
}

/**
 * Plan-wide count of blocking issues for the header: one per prereq-misplaced
 * course plus one per antireq conflict SET (not per course). Program-agnostic —
 * group cardinality doesn't depend on the keeper.
 */
export function countPlacementIssues(
  issues: readonly PlacementIssue[],
): number {
  let prereqs = 0;
  for (const i of issues) {
    if (i.courseCode !== "" && i.kind === "prereq") prereqs++;
  }
  return prereqs + antireqConflictGroups(issues).length;
}
