import { fmtUnits, pluralize } from "@/lib/format";
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
      lead={`${fmtUnits(section.needUnits)} ${pluralize(section.needUnits, "unit")}`}
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
