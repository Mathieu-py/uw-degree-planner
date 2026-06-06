import type { SubjectPoolNode } from "@/lib/programs";
import type { DrillFn } from "../types";
import { PoolCard } from "./PoolCard";

/** Level buckets within a pool's [min,max] range (bucketed values). [] = all. */
function poolLevels(min?: number, max?: number): number[] {
  const all = [100, 200, 300, 400];
  const sub = all.filter(
    (b) => (min == null || b >= min) && (max == null || b <= max),
  );
  return sub.length === all.length ? [] : sub;
}

/** Human level-range note, e.g. "300–400 level". Null when unbounded. */
function poolLevelText(min?: number, max?: number): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null)
    return min === max ? `${min} level` : `${min}–${max} level`;
  if (min != null) return `${min}+ level`;
  return `up to ${max} level`;
}

/** An open subject pool: "choose N courses in these subjects/levels". */
export function SubjectPoolBody({
  node,
  onDrill,
}: {
  node: SubjectPoolNode;
  onDrill?: DrillFn;
}) {
  const subjects = node.subjectCodes.map((s) => s.toUpperCase());
  return (
    <PoolCard
      lead={`Choose ${node.selectCount} course${node.selectCount === 1 ? "" : "s"}`}
      subjects={subjects}
      levelText={poolLevelText(node.minLevel, node.maxLevel)}
      satisfiers={[]}
      onBrowse={
        onDrill
          ? () =>
              onDrill([], {
                includePrefixes: subjects,
                levels: poolLevels(node.minLevel, node.maxLevel),
              })
          : null
      }
    />
  );
}
