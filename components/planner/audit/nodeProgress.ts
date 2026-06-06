import { type AuditNode, summarize } from "@/lib/audit/compile";

/**
 * Satisfied/needed for a node, EXCLUDING illegally-placed satisfiers — a course
 * placed before its prereqs (or in an antireq conflict) doesn't credit here, the
 * same way the header bar never credits it. Keeps every ring/count consistent
 * with the headline. (Legality is only populated when a catalog is present; the
 * read-only view has none, so this is a no-op there.)
 */
export function nodeProgress(node: AuditNode): {
  needed: number;
  satisfied: number;
} {
  const s = summarize(node);
  const illegal = node.illegalSatisfiers?.length ?? 0;
  return { needed: s.needed, satisfied: Math.max(0, s.satisfied - illegal) };
}

/** Progress ring for a sub-labeled node block (a term, spec, named sub-group). */
export function ringFor(node: AuditNode): {
  pct: number;
  num: number;
  optional: boolean;
} {
  const { needed, satisfied } = nodeProgress(node);
  const optional = needed === 0;
  return {
    pct: optional ? 0 : Math.min(Math.round((satisfied / needed) * 100), 100),
    num: satisfied,
    optional,
  };
}
