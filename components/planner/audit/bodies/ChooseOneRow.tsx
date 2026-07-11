import { creditedChipCodes, type ScoredNode } from "@/lib/audit/score";
import type { Course } from "@/lib/courses/types";
import { pluralize, progressPct } from "@/lib/format";
import { MetChip, WarnChip } from "../cards/Chip";
import { Recede } from "../cards/Recede";
import { RingLead } from "../cards/RingLead";
import { StatusCard } from "../cards/StatusCard";
import { StatusPill } from "../cards/StatusPill";
import type { DragWiring, DrillFn } from "../types";
import { OptionChip } from "./OptionChip";

/** Element B — a pick(N-of-M) over single courses: draggable option chips that
 *  recede to the chosen course(s) once the choice is decided. */
export function ChooseOneRow({
  scored,
  options,
  illegalCodes,
  catalogByCode,
  onDrill,
  drag,
}: {
  scored: ScoredNode;
  options: string[];
  illegalCodes: ReadonlySet<string>;
  catalogByCode: Map<string, Course>;
  onDrill?: DrillFn;
  drag?: DragWiring;
}) {
  const node = scored.node;
  const r = node.ruleNode;
  if (r.kind !== "pick") return null;
  const selectMin = r.selectMin ?? 1;
  const { needed, credit, complete } = scored;
  const title = node.description ?? "Choose one";
  const caption = `${selectMin} of ${options.length} ${pluralize(options.length, "option")}`;
  // Open-state chips show raw plan presence (drag UX), even when the match
  // credited a course elsewhere.
  const satisfierCodes = new Set(node.satisfiers.map((s) => s.code));
  // The satisfier fallback covers a vacuously-met optional pick, whose
  // satisfiers aren't in any bucket.
  const chosenCodes =
    scored.creditedCodes.length > 0
      ? creditedChipCodes(scored, illegalCodes)
      : satisfierCodes;

  if (complete) {
    return (
      <Recede title={title} caption={caption}>
        <div className="cd-chips">
          {[...chosenCodes].map((code) =>
            illegalCodes.has(code) ? (
              <WarnChip
                key={code}
                code={code}
                name={catalogByCode.get(code)?.name}
              />
            ) : (
              <MetChip
                key={code}
                code={code}
                name={catalogByCode.get(code)?.name}
              />
            ),
          )}
        </div>
      </Recede>
    );
  }
  const pct = progressPct(credit, needed, 0);
  return (
    <StatusCard
      tone={credit > 0 ? "partial" : "missing"}
      lead={<RingLead pct={pct} num={credit} tone="neutral" />}
      title={title}
      caption={caption}
      pill={
        <StatusPill
          variant="decide"
          label={selectMin === 1 ? "Choose 1" : `Choose ${selectMin}`}
        />
      }
    >
      <div className="cd-metaline">
        Pick <b>{selectMin === 1 ? "any one" : `any ${selectMin}`}</b> — drag{" "}
        {selectMin === 1 ? "it" : "them"} into a term.
      </div>
      <div className="cd-chips">
        {options.map((code) => (
          <OptionChip
            key={code}
            code={code}
            placed={satisfierCodes.has(code)}
            illegal={illegalCodes.has(code)}
            catalogByCode={catalogByCode}
            onDrill={onDrill}
            drag={drag}
          />
        ))}
      </div>
    </StatusCard>
  );
}
