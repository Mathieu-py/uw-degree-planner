import { fmtUnits } from "@/lib/format";
import type { DrillFn, Section } from "../types";
import { PoolCard } from "./PoolCard";

/**
 * A breadth/distribution requirement ("1.0 unit of Humanities: CLAS, ENGL, …").
 * Criteria-based like a subject pool; placed courses in those subjects show met.
 */
export function BreadthBody({
  section,
  onDrill,
}: {
  section: Extract<Section, { kind: "breadth" }>;
  onDrill?: DrillFn;
}) {
  return (
    <PoolCard
      lead={`${fmtUnits(section.needUnits)} unit${section.needUnits === 1 ? "" : "s"}`}
      subjects={section.subjects}
      levelText={null}
      satisfiers={section.satisfiers}
      onBrowse={
        onDrill
          ? () => onDrill([], { includePrefixes: section.subjects })
          : null
      }
    />
  );
}
