import type { RuleNode } from "./types";

/** Pre-order traversal of a rule tree, visiting every node once. */
export function walkRule(node: RuleNode, visit: (n: RuleNode) => void): void {
  visit(node);
  if (node.kind === "all" || node.kind === "pick") {
    for (const c of node.children) walkRule(c, visit);
  }
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
