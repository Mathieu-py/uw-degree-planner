import { type AuditNode, summarize } from "@/lib/audit/compile";

/**
 * Satisfied/needed for a node, EXCLUDING illegally-placed satisfiers (same as
 * the header bar), so every ring/count matches the headline. Legality is only
 * populated with a catalog, so this is a no-op in the read-only view.
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
