import { type AuditNode, summarize } from "@/lib/audit/compile";
import type { NodeFill } from "@/lib/audit/progress";

/**
 * Distinct-credit satisfied count for `node`'s whole subtree: the sum of the
 * per-node filled-slot totals the headline's bipartite match recorded (every
 * bucket owner lives somewhere under here). Summing the subtree is robust to how
 * picks decompose into child + residual buckets.
 */
function sumOwnedFill(node: AuditNode, fill: NodeFill): number {
  let total = fill.get(node) ?? 0;
  for (const c of node.children) total += sumOwnedFill(c, fill);
  return total;
}

/**
 * Satisfied/needed for a node. With a `fill` map (the catalog-backed view),
 * `satisfied` is the SAME one-course-per-requirement credit as the unit headline
 * — so an overlapping pool whose courses are claimed elsewhere reads unmet
 * instead of re-counting them. Illegal placements are already excluded before the
 * match, so they aren't subtracted again on this path.
 *
 * Without a fill map (the read-only view, where legality isn't populated), fall
 * back to the independent per-node `summarize`, minus any illegal satisfiers —
 * identical to the prior behaviour.
 */
export function nodeProgress(
  node: AuditNode,
  fill?: NodeFill,
): {
  needed: number;
  satisfied: number;
} {
  const s = summarize(node);
  if (fill) {
    // `summarize` already collapses cross-listed twins into `needed`; cap the
    // distinct credit at it so an over-counted subtree can't exceed its need.
    return {
      needed: s.needed,
      satisfied: Math.min(sumOwnedFill(node, fill), s.needed),
    };
  }
  const illegal = node.illegalSatisfiers?.length ?? 0;
  return { needed: s.needed, satisfied: Math.max(0, s.satisfied - illegal) };
}

/** Progress ring for a sub-labeled node block (a term, spec, named sub-group). */
export function ringFor(
  node: AuditNode,
  fill?: NodeFill,
): {
  pct: number;
  num: number;
  optional: boolean;
} {
  const { needed, satisfied } = nodeProgress(node, fill);
  const optional = needed === 0;
  return {
    pct: optional ? 0 : Math.min(Math.round((satisfied / needed) * 100), 100),
    num: satisfied,
    optional,
  };
}
