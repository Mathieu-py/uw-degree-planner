import { countNoun, formatLevelRange } from "@/lib/format";
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
      lead={`Choose ${countNoun(node.selectCount, "course")}`}
      subjects={subjects}
      levelText={formatLevelRange(node.minLevel, node.maxLevel)}
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
