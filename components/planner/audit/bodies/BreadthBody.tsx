import { fmtUnits, joinWithOverflow, pluralize, unitsMet } from "@/lib/format";
import { MetChip } from "../cards/Chip";
import { FindRow } from "../cards/FindRow";
import { Recede } from "../cards/Recede";
import { RingLead } from "../cards/RingLead";
import { StatusCard } from "../cards/StatusCard";
import { StatusPill } from "../cards/StatusPill";
import type { DrillFn, Section } from "../types";

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
  const complete = unitsMet(placedUnits, needUnits);
  const pct =
    needUnits > 0
      ? Math.min(Math.round((placedUnits / needUnits) * 100), 100)
      : 100;

  const chips = (
    <div className="cd-chips">
      {satisfiers.map((code) => (
        <MetChip key={code} code={code} />
      ))}
    </div>
  );

  if (complete) {
    return (
      <Recede
        title={title}
        meta={`${fmtUnits(needUnits)}/${fmtUnits(needUnits)}`}
      >
        {chips}
      </Recede>
    );
  }
  return (
    <StatusCard
      tone={placedUnits > 0 ? "partial" : "missing"}
      lead={<RingLead pct={pct} num={fmtUnits(done)} />}
      title={title}
      pill={
        placedUnits > 0 ? (
          <StatusPill variant="progress" label="In progress" />
        ) : undefined
      }
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
    </StatusCard>
  );
}
