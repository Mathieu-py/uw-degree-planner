import { Icon } from "@/components/ui/Icon";
import type { Section } from "@/lib/audit/view/types";
import type { Course } from "@/lib/courses/types";
import { fmtUnits, pluralize, unitsMet } from "@/lib/format";
import { BreadthBody } from "../bodies/BreadthBody";
import { OptionChip } from "../bodies/OptionChip";
import { MetChip, WarnChip } from "../cards/Chip";
import { CountedCard, OpenCard } from "../cards/CountedCard";
import { FindRow } from "../cards/FindRow";
import { GlyphLead } from "../cards/RingLead";
import { StatusCard } from "../cards/StatusCard";
import { StatusPill } from "../cards/StatusPill";
import type { DragWiring, DrillFn } from "../types";

/**
 * One requirement section rendered in the Status-Cards grammar. The `elective*`
 * / breadth / levelFloor / info kinds each render their own collapsible card
 * (or a green recede row once satisfied).
 */
export function SectionRow({
  section,
  placedCodes,
  illegalCodes,
  catalogByCode,
  onDrill,
  drag,
}: {
  section: Section;
  placedCodes: ReadonlySet<string>;
  illegalCodes: ReadonlySet<string>;
  catalogByCode: Map<string, Course>;
  onDrill?: DrillFn;
  drag?: DragWiring;
}) {
  // I · Notes & constraints — advisory, no ring/progress.
  if (section.kind === "infoGroup") {
    const count = section.items.length;
    return (
      <StatusCard
        tone="missing"
        lead={<GlyphLead name="warning" />}
        title={groupTitle(section.title, count)}
        pill={<StatusPill variant="note" label="Note" />}
      >
        <ul className="cd-notes">
          {section.items.map((text, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static list, order fixed
            <li key={i}>{text}</li>
          ))}
        </ul>
      </StatusCard>
    );
  }

  // A single informational row — the open "Free electives" volume today. Any
  // course counts, so it ends with a Find-courses row into the full catalog.
  if (section.kind === "info") {
    return (
      <OpenCard title={section.title} num={0}>
        <div className="cd-metaline">{section.caption}</div>
        {onDrill ? (
          <FindRow label="Add electives" onFind={() => onDrill([], {})} />
        ) : null}
      </OpenCard>
    );
  }

  // F · Finite elective list — pick N from a fixed set of draggable chips.
  if (section.kind === "electiveFinite") {
    const placed = Math.min(section.placed, section.need);
    return (
      <CountedCard
        title={section.title}
        caption={section.caption}
        done={placed}
        need={section.need}
        num={placed}
        complete={section.placed >= section.need}
        recedeMeta={`${section.need}/${section.need}`}
        recedeChildren={
          <div className="cd-chips">
            {section.options
              .filter((c) => placedCodes.has(c))
              .map((code) =>
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
        }
      >
        <div className="cd-metaline">
          <b>
            {placed} of {section.need}
          </b>{" "}
          chosen from this fixed list.
        </div>
        <div className="cd-chips">
          {section.options.map((code) => (
            <OptionChip
              key={code}
              code={code}
              placed={placedCodes.has(code)}
              illegal={illegalCodes.has(code)}
              catalogByCode={catalogByCode}
              onDrill={onDrill}
              drag={drag}
            />
          ))}
        </div>
      </CountedCard>
    );
  }

  // E · Breadth — unit-based distribution (owns its own card + recede).
  if (section.kind === "breadth") {
    return <BreadthBody section={section} onDrill={onDrill} />;
  }

  // H · Level floor — a unit minimum tracked across the whole plan; no picker.
  if (section.kind === "levelFloor") {
    const done = Math.min(section.placedUnits, section.needUnits);
    return (
      <CountedCard
        title={section.title}
        caption={section.caption}
        done={done}
        need={section.needUnits}
        num={fmtUnits(done)}
        complete={unitsMet(section.placedUnits, section.needUnits)}
        recedeMeta={`${fmtUnits(section.needUnits)}/${fmtUnits(section.needUnits)}`}
        recedeChildren={
          <div className="cd-chips">
            {section.satisfiers.map((code) => (
              <MetChip key={code} code={code} />
            ))}
          </div>
        }
      >
        <div className="cd-metaline">
          <b>
            {fmtUnits(done)} of {fmtUnits(section.needUnits)} units
          </b>{" "}
          — counted automatically as you place upper-year courses.
        </div>
        <div className="cd-auto">
          <span className="cd-auto-ico">
            <Icon name="lock" size="xs" aria-hidden="true" />
          </span>
          No list to pick from — tracked across your whole plan, so there's
          nothing to drag.
        </div>
      </CountedCard>
    );
  }

  // G · Open elective / Explore — electiveBrowse. A concrete eligible list →
  // draggable chips; a listless / unit-based pool → browse the catalog.
  const hasList = section.eligibleCodes.length > 0;
  if (hasList) {
    const placed = section.eligibleCodes.filter((c) =>
      placedCodes.has(c),
    ).length;
    return (
      <OpenCard title={section.title} caption={section.caption} num={placed}>
        <div className="cd-metaline">
          Drag any from this list, or click to add.
        </div>
        <div className="cd-chips">
          {section.eligibleCodes.map((code) => (
            <OptionChip
              key={code}
              code={code}
              placed={placedCodes.has(code)}
              illegal={illegalCodes.has(code)}
              catalogByCode={catalogByCode}
              onDrill={onDrill}
              drag={drag}
            />
          ))}
        </div>
      </OpenCard>
    );
  }
  return (
    <OpenCard title={section.title} caption={section.caption} num={0}>
      <div className="cd-metaline">
        {section.unitBased
          ? "Measured in units — no fixed list to drag, so browse the catalog."
          : "No fixed list to drag — browse the catalog for eligible courses."}
      </div>
      {onDrill ? (
        <FindRow label="Add electives" onFind={() => onDrill([], {})} />
      ) : null}
    </OpenCard>
  );
}

/** "Additional constraint" + 7 → "Additional constraints · 7"; pluralizes the
 *  last word so a folded group reads naturally. A last word that is ALREADY
 *  plural ("Failed units") is left alone, else it double-"s"es ("unitss").
 *  Single note → bare title. Exported for unit testing. */
export function groupTitle(title: string, count: number): string {
  if (count <= 1) return title;
  const sp = title.lastIndexOf(" ");
  const lastWord = sp === -1 ? title : title.slice(sp + 1);
  const head = sp === -1 ? "" : title.slice(0, sp + 1);
  const plural = /s$/i.test(lastWord) ? lastWord : pluralize(count, lastWord);
  return `${head}${plural} · ${count}`;
}
