/**
 * Human-readable prereq descriptions. Unlike the flat `missingCourses` from
 * {@link evaluate}, preserves structure — "one of X, Y, Z" for a choice, "; "
 * between requirements — so the student sees exactly what's outstanding.
 */

import { formatCourseCode } from "@/lib/format";
import type { ProgramIdentity } from "@/lib/programs";
import type { PrereqNode } from "./parse";
import { evaluate, type UserState } from "./satisfied";

/**
 * Render a full requirement tree as prose, regardless of completion (e.g. course
 * detail page). Parenthesizes nested boolean groups so "X or Y and Z" can't
 * misread (mirrors the Calendar). Null for an empty tree → callers fall back to
 * source prose.
 */
export function describePrereqs(
  node: PrereqNode | null | undefined,
): string | null {
  if (!node) return null;
  const text = describeNode(node, true).trim();
  return text.length > 0 ? text : null;
}

/**
 * Like {@link describePrereqs}, but splits a top-level AND into separate
 * requirements (one per line) instead of bracketing. Flatten invariant: each
 * part is a leaf, OR, or countOf (never AND), so parts render flat; brackets
 * survive only within a mixed boolean part. Null for an empty tree → source prose.
 */
export function describePrereqParts(
  node: PrereqNode | null | undefined,
): string[] | null {
  if (!node) return null;
  const parts =
    node.kind === "and"
      ? node.children.map((c) => describeNode(c, true))
      : [describeNode(node, true)];
  const cleaned = parts.map((p) => p.trim()).filter((p) => p.length > 0);
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Tidy a `raw` node's source text: drop Kuali's trailing "(see above/below)"
 * page pointers (meaningless in our card layout). Wording and course codes
 * otherwise preserved verbatim.
 */
function cleanRawText(text: string): string {
  return text.replace(/\s*\(\s*see\s+(?:above|below)\s*\)\s*$/i, "").trim();
}

/**
 * Render a requirement subtree as prose, met or not. Stays flat except a nested
 * boolean group of the opposite kind, which is bracketed — those brackets are
 * load-bearing (precedence: "X or Y and Z").
 *
 * `top` suppresses the outer bracket. Don't pass via `.map(describeNode)` — the
 * array index would land in `top`.
 */
/** Peel `coreqOf` wrappers — they're shown inline as the courses they hold. */
const unwrapCoreq = (n: PrereqNode): PrereqNode =>
  n.kind === "coreqOf" ? unwrapCoreq(n.child) : n;

/**
 * The children of an and/or as displayed: each `coreqOf` is replaced by its
 * inner requirement, and a same-kind inner group is spliced in so
 * "STAT 220 or coreqOf(STAT 230 or STAT 240)" reads as the flat
 * "STAT 220 or STAT 230 or STAT 240" rather than a nested, bracketed group.
 */
function displayChildren(
  children: PrereqNode[],
  kind: "and" | "or",
): PrereqNode[] {
  return children.flatMap((c) => {
    const u = unwrapCoreq(c);
    return u.kind === kind ? u.children : [u];
  });
}

function describeNode(node: PrereqNode, top = false): string {
  switch (node.kind) {
    case "course":
      return formatCourseCode(node.code);
    case "level":
      return `Level at least ${node.minLevel}`;
    case "program":
      return node.clause;
    case "raw":
      return cleanRawText(node.text);
    case "coreqOf":
      // Shown inline as its underlying requirement. The corequisite nuance
      // (satisfiable by concurrent enrollment) is enforced in satisfied.ts; in
      // prose we just list the courses as alternatives. `top` carries through so
      // a lone coreqOf keeps the bracketing its child would have on its own.
      return describeNode(node.child, top);
    case "or":
    case "and": {
      const sep = node.kind === "or" ? " or " : " and ";
      // Flatten: a compound child differs in kind from its parent, so any nested
      // and/or needs brackets; the top-level group never does.
      const inner = displayChildren(node.children, node.kind)
        .map((c) => describeNode(c))
        .join(sep);
      return top ? inner : `(${inner})`;
    }
    case "countOf":
      return `${node.n} of ${node.children
        .map((c) => describeNode(c))
        .join(", ")}`;
  }
}

/**
 * Describe only the still-unmet portion against `completed`, keeping "one of"
 * choices intact. Null when nothing course-based is outstanding (satisfied, or
 * only uncertain level/program/free-text remain — surfaced elsewhere).
 */
export function describeMissingPrereqs(
  node: PrereqNode | null,
  completed: ReadonlySet<string>,
  opts?: {
    level?: string;
    programs?: ProgramIdentity[];
    concurrent?: ReadonlySet<string>;
  },
): string | null {
  if (!node) return null;
  // Same context the verdict used, so level/program/coreqOf branches resolve
  // identically — else an OR mixing a course with a known-failing level would
  // bias to "satisfiable" and drop the course alternative. `concurrent` matters
  // for coreqOf: without it the unmet-gate could disagree with the planner badge.
  return unmet(node, {
    completed,
    level: opts?.level,
    programs: opts?.programs,
    concurrent: opts?.concurrent,
  });
}

function unmet(node: PrereqNode, state: UserState): string | null {
  // A satisfied (or uncertainty-biased) subtree has nothing outstanding;
  // mirrors satisfied.ts so we never list an already-met option group.
  if (evaluate(node, state).satisfied) return null;
  switch (node.kind) {
    case "course":
      return formatCourseCode(node.code);
    case "or":
      // Unsatisfied OR ⇒ no branch met and none uncertain ⇒ list every option,
      // coreqOf branches inlined so the choice reads as one flat list.
      return `one of ${displayChildren(node.children, "or")
        .map((c) => describeNode(c))
        .join(", ")}`;
    case "countOf":
      // Unsatisfied countOf ⇒ can't yet reach n ⇒ list every option.
      return `${node.n} of ${node.children
        .map((c) => describeNode(c))
        .join(", ")}`;
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
