/**
 * Human-readable prereq descriptions. Unlike the flat `missingCourses` list
 * from {@link evaluate}, this preserves the requirement's structure — "one of
 * X, Y, Z" for a choice, "; " between separate requirements — so a student sees
 * exactly what's outstanding rather than an ambiguous comma list.
 */

import { formatCourseCode } from "@/lib/format";
import type { ProgramIdentity } from "@/lib/programs";
import type { PrereqNode } from "./parse";
import { evaluate, type UserState } from "./satisfied";

/** Render a requirement subtree as prose, regardless of whether it's met. */
function describeNode(node: PrereqNode): string {
  switch (node.kind) {
    case "course":
      return formatCourseCode(node.code);
    case "or":
      return node.children.map(describeNode).join(" or ");
    case "and":
      return node.children.map(describeNode).join(" and ");
    case "level":
      return `Level at least ${node.minLevel}`;
    case "program":
      return node.clause;
    case "raw":
      return node.text;
  }
}

/**
 * Describe only the still-unmet portion of a prereq tree against `completed`,
 * keeping "one of" choices intact and listing every option. Returns null when
 * nothing course-based is outstanding (satisfied, or only uncertain level /
 * program / free-text notes remain — those are surfaced elsewhere).
 */
export function describeMissingPrereqs(
  node: PrereqNode | null,
  completed: ReadonlySet<string>,
  opts?: { level?: string; programs?: ProgramIdentity[] },
): string | null {
  if (!node) return null;
  // Same context the verdict used, so a level/program branch resolves the same
  // way here — otherwise an OR mixing a course with a known-failing level would
  // be biased to "satisfiable" and drop the course alternative from the text.
  return unmet(node, {
    completed,
    level: opts?.level,
    programs: opts?.programs,
  });
}

function unmet(node: PrereqNode, state: UserState): string | null {
  // A satisfied (or uncertainty-biased) subtree has nothing outstanding. This
  // mirrors the OR/AND semantics in satisfied.ts so we never list an option
  // group the student has actually met.
  if (evaluate(node, state).satisfied) return null;
  switch (node.kind) {
    case "course":
      return formatCourseCode(node.code);
    case "or":
      // Unsatisfied OR ⇒ no branch met and none uncertain ⇒ list every option.
      return `one of ${node.children.map(describeNode).join(", ")}`;
    case "and": {
      const parts = node.children
        .map((c) => unmet(c, state))
        .filter((p): p is string => p !== null);
      return parts.length > 0 ? parts.join("; ") : null;
    }
    default:
      // level / program / raw resolve to "uncertain", never a hard miss here.
      return null;
  }
}
