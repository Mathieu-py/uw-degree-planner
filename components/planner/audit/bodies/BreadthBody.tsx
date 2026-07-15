import type { Section } from "@/lib/audit/view/types";
import { fmtUnits, joinWithOverflow, pluralize, unitsMet } from "@/lib/format";
import { MetChip } from "../cards/Chip";
import { CountedCard } from "../cards/CountedCard";
import { FindRow } from "../cards/FindRow";
import type { DrillFn } from "../types";

/**
 * Element E — a unit-based distribution requirement ("1.0 unit of Humanities:
 * CLAS, ENGL, …"). Criteria-based like a subject pool but the ring/counter run
 * on units; the Find-courses row is filtered to the eligible subjects.
 */
export function BreadthBody({
  section,
  onDrill,
}: {
  section: Extract<Section, { kind: "breadth" }>;
  onDrill?: DrillFn;
}) {
  const { needUnits, placedUnits, subjects, satisfiers, title } = section;
  const done = Math.min(placedUnits, needUnits);
  const remaining = Math.max(0, needUnits - placedUnits);

  const chips = (
    <div className="cd-chips">
      {satisfiers.map((code) => (
        <MetChip key={code} code={code} />
      ))}
    </div>
  );

  return (
    <CountedCard
      title={title}
      done={done}
      need={needUnits}
      num={fmtUnits(done)}
      complete={unitsMet(placedUnits, needUnits)}
      recedeMeta={`${fmtUnits(needUnits)}/${fmtUnits(needUnits)}`}
      recedeChildren={chips}
    >
      <div className="cd-metaline">
        <b>
          {fmtUnits(done)} of {fmtUnits(needUnits)}{" "}
          {pluralize(needUnits, "unit")}
        </b>{" "}
        from <b>{joinWithOverflow(subjects)}</b>.
      </div>
      {satisfiers.length > 0 ? chips : null}
      {onDrill ? (
        <FindRow
          label={`Add ${fmtUnits(remaining)} more ${pluralize(remaining, "unit")}`}
          onFind={() => onDrill([], { includePrefixes: subjects })}
        />
      ) : null}
    </CountedCard>
  );
}
