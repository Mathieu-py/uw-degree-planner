import { type AuditNode, isLegallyMet } from "@/lib/audit/compile";
import type { Course } from "@/lib/courses/types";
import { pluralize, progressPct } from "@/lib/format";
import { MetChip, WarnChip } from "../cards/Chip";
import { Recede } from "../cards/Recede";
import { RingLead } from "../cards/RingLead";
import { StatusCard } from "../cards/StatusCard";
import { StatusPill } from "../cards/StatusPill";
import { nodeProgress } from "../nodeProgress";
import type { DragWiring, DrillFn } from "../types";
import { OptionChip } from "./OptionChip";

/** Element B — a pick(N-of-M) over single courses: draggable option chips that
 *  recede to the chosen course(s) once the choice is decided. */
export function ChooseOneRow({
  node,
  options,
  illegalCodes,
  catalogByCode,
  onDrill,
  drag,
}: {
  node: AuditNode;
  options: string[];
  illegalCodes: ReadonlySet<string>;
  catalogByCode: Map<string, Course>;
  onDrill?: DrillFn;
  drag?: DragWiring;
}) {
  const r = node.ruleNode;
  if (r.kind !== "pick") return null;
  const selectMin = r.selectMin ?? 1;
  const { needed, satisfied } = nodeProgress(node);
  // Only collapse to the chosen chip(s) once a placement satisfies the choice.
  // A vacuously-met optional pick has no satisfiers and would render empty, so
  // keep showing the options until truly decided.
  const decided = isLegallyMet(node);
  const title = node.description ?? "Choose one";
  const caption = `${selectMin} of ${options.length} ${pluralize(options.length, "option")}`;
  const satisfierCodes = new Set(node.satisfiers.map((s) => s.code));

  if (decided) {
    return (
      <Recede title={title} caption={caption}>
        <div className="cd-chips">
          {[...satisfierCodes].map((code) =>
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
  const pct = progressPct(satisfied, needed, 0);
  return (
    <StatusCard
      tone={satisfied > 0 ? "partial" : "missing"}
      lead={<RingLead pct={pct} num={satisfied} tone="neutral" />}
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
