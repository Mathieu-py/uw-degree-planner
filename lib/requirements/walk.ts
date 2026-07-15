import type { RuleNode } from "./types";

/** Pre-order traversal of a rule tree, visiting every node once. */
export function walkRule(node: RuleNode, visit: (n: RuleNode) => void): void {
  visit(node);
  if (node.kind === "all" || node.kind === "pick") {
    for (const c of node.children) walkRule(c, visit);
  }
}

/**
 * Flat course options of a `pick` whose children are ALL `courses` leaves,
 * deduped in first-occurrence order; null when the pick is compound (any
 * non-`courses` child, or no children). The one definition of "flat pick",
 * shared by the compiler, headline, scorer, and variant picker — they must
 * agree or the tree, headline, cards, and picker silently diverge.
 */
export function flatCoursePickOptions(
  node: Extract<RuleNode, { kind: "pick" }>,
): string[] | null {
  if (node.children.length === 0) return null;
  const out: string[] = [];
  for (const c of node.children) {
    if (c.kind !== "courses") return null;
    out.push(...c.courses);
  }
  return [...new Set(out)];
}

/**
 * A `pick` whose `selectMin` equals its unique course-leaf count is
 * functionally mandatory (Kuali sometimes emits mandatory rules as `pick(1,1)`
 * not `all`). Returns the flat course codes if so, else null.
 */
export function functionallyMandatoryCourses(node: RuleNode): string[] | null {
  if (node.kind !== "pick" || node.selectMin === undefined) return null;
  const leafCourses: string[] = [];
  for (const c of node.children) {
    if (c.kind !== "courses") return null;
    leafCourses.push(...c.courses);
  }
  return new Set(leafCourses).size === node.selectMin ? leafCourses : null;
}

function collectRequired(
  node: RuleNode,
  inAllOnly: boolean,
  out: Set<string>,
): void {
  if (node.kind === "courses") {
    if (inAllOnly) for (const c of node.courses) out.add(c);
    return;
  }
  if (node.kind === "subjectPool" || node.kind === "excluded") return;
  if (inAllOnly) {
    const mandatory = functionallyMandatoryCourses(node);
    if (mandatory !== null) {
      for (const c of mandatory) out.add(c);
      return;
    }
  }
  const childAllOnly = inAllOnly && node.kind === "all";
  for (const c of node.children) collectRequired(c, childAllOnly, out);
}

/** Required courses inside a single rule tree (courses under all-only paths). */
export function requiredCoursesIn(node: RuleNode): string[] {
  const out = new Set<string>();
  collectRequired(node, true, out);
  return [...out].sort();
}
