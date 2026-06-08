import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { Ring } from "@/components/ui/Ring";
import type { Course } from "@/lib/courses/types";
import { countNoun, pluralize } from "@/lib/format";
import { BreadthBody } from "../bodies/BreadthBody";
import { NodeBody } from "../bodies/NodeBody";
import { OptionChip } from "../bodies/OptionChip";
import type { DragWiring, DrillFn, Section } from "../types";

export function SectionRow({
  section,
  open,
  placedCodes,
  illegalCodes,
  catalog,
  catalogByCode,
  onDrill,
  drag,
}: {
  section: Section;
  open: boolean;
  placedCodes: ReadonlySet<string>;
  illegalCodes: ReadonlySet<string>;
  catalog?: Course[];
  catalogByCode: Map<string, Course>;
  onDrill?: DrillFn;
  drag?: DragWiring;
}) {
  if (section.kind === "info") {
    return (
      <div className="av-row">
        <div className="av-row-head items-start">
          <span className="av-unit-ring shrink-0">
            <Icon name="doc" size="sm" aria-hidden="true" />
          </span>
          <span className="flex flex-col gap-0.5 flex-1 min-w-0 text-left">
            <span className="av-sec-label">{section.title}</span>
            <span className="u-small">{section.caption}</span>
          </span>
        </div>
      </div>
    );
  }

  if (section.kind === "node") {
    // An optional group (needed === 0) has no target, so the ring reflects what's
    // *chosen*: grey 0 when empty, green count once anything is picked. Required
    // groups (needed > 0) keep their normal progress ring.
    const optional = section.summary.needed === 0;
    const chosen = optional
      ? section.node.satisfiers.length
      : section.summary.satisfied;
    const pct = optional
      ? chosen > 0
        ? 100
        : 0
      : Math.min(
          Math.round(
            (section.summary.satisfied / section.summary.needed) * 100,
          ),
          100,
        );
    return (
      <SectionShell
        // Tag "(optional)" and use a neutral ring tone so a pick doesn't read as
        // a met *required* group.
        title={optional ? `${section.title} (optional)` : section.title}
        caption={section.caption}
        ring={{ pct, num: chosen, tone: optional ? "neutral" : undefined }}
        excludedViolationCount={section.summary.excludedViolationCount}
        legalityIssueCount={section.node.illegalSatisfiers?.length ?? 0}
        open={open}
      >
        <NodeBody
          node={section.node}
          placedCodes={placedCodes}
          illegalCodes={illegalCodes}
          catalog={catalog}
          catalogByCode={catalogByCode}
          onDrill={onDrill}
          drag={drag}
        />
      </SectionShell>
    );
  }

  if (section.kind === "electiveFinite") {
    const pct =
      section.need > 0
        ? Math.min(Math.round((section.placed / section.need) * 100), 100)
        : 100;
    return (
      <SectionShell
        title={section.title}
        caption={section.caption}
        ring={{ pct, num: Math.min(section.placed, section.need) }}
        open={open}
      >
        <p className="av-hint mb-1.5">
          Pick {section.need} from this list — drag any in, or click to browse.
        </p>
        <div className="av-chips">
          {section.options.map((code) => (
            <OptionChip
              key={code}
              code={code}
              placed={placedCodes.has(code)}
              catalogByCode={catalogByCode}
              onDrill={onDrill}
              drag={drag}
            />
          ))}
        </div>
      </SectionShell>
    );
  }

  if (section.kind === "breadth") {
    // Breadth is unit-based; ring fills on units, the number counts contributing
    // placed courses.
    const pct =
      section.needUnits > 0
        ? Math.min(
            Math.round((section.placedUnits / section.needUnits) * 100),
            100,
          )
        : 100;
    return (
      <SectionShell
        title={section.title}
        caption={section.caption}
        ring={{ pct, num: section.satisfiers.length }}
        open={open}
      >
        <BreadthBody section={section} onDrill={onDrill} />
      </SectionShell>
    );
  }

  if (section.kind === "levelFloor") {
    // A unit-based minimum ("X units at the 200-level or above"). Ring fills on
    // units, the number counts contributing placed courses. Static row — no
    // courses to drag, so a dropdown would only restate the requirement.
    const pct =
      section.needUnits > 0
        ? Math.min(
            Math.round((section.placedUnits / section.needUnits) * 100),
            100,
          )
        : 100;
    return (
      <div className="av-row">
        <div className="av-row-head">
          <span className="av-ring-wrap">
            <Ring pct={pct} />
            <span className="av-ring-num">{section.satisfiers.length}</span>
          </span>
          <span className="flex flex-col gap-0.5 flex-1 min-w-0 text-left">
            <span className="av-sec-label">{section.title}</span>
            <span className="u-small truncate">{section.caption}</span>
          </span>
        </div>
      </div>
    );
  }

  // electiveBrowse: a concrete eligible list → draggable chips (no target →
  // neutral ring); only a unit-based / open pool falls back to "browse catalog".
  const hasList = section.eligibleCodes.length > 0;
  if (hasList) {
    const placed = section.eligibleCodes.filter((c) =>
      placedCodes.has(c),
    ).length;
    return (
      <SectionShell
        title={section.title}
        caption={section.caption}
        ring={{ pct: 0, num: placed }}
        open={open}
      >
        <p className="av-hint mb-1.5">
          Drag any from this list, or click to add.
        </p>
        <div className="av-chips">
          {section.eligibleCodes.map((code) => (
            <OptionChip
              key={code}
              code={code}
              placed={placedCodes.has(code)}
              catalogByCode={catalogByCode}
              onDrill={onDrill}
              drag={drag}
            />
          ))}
        </div>
      </SectionShell>
    );
  }
  // No fixed list — unit-based or an open pool: browse the catalog.
  return (
    <SectionShell title={section.title} caption={section.caption} open={open}>
      <p className="av-hint mb-1.5">
        {section.unitBased
          ? "Measured in units — there's no fixed list to drag, so browse the catalog."
          : "There's no fixed list to drag, so browse the catalog."}
      </p>
    </SectionShell>
  );
}

function SectionShell({
  title,
  caption,
  ring,
  excludedViolationCount = 0,
  legalityIssueCount = 0,
  open,
  children,
}: {
  title: string;
  caption: string;
  /** Present → progress ring; absent → neutral doc glyph (unit/browse rows). */
  ring?: { pct: number; num: number; tone?: "neutral" };
  excludedViolationCount?: number;
  /** Satisfiers here that are placed illegally (met-but-flagged). */
  legalityIssueCount?: number;
  open: boolean;
  children: ReactNode;
}) {
  return (
    <details className="av-row group" open={open}>
      <summary className="av-row-head list-none select-none [&::-webkit-details-marker]:hidden">
        {ring ? (
          <span className="av-ring-wrap">
            <Ring pct={ring.pct} tone={ring.tone} />
            <span className="av-ring-num">{ring.num}</span>
          </span>
        ) : (
          <span className="av-unit-ring">
            <Icon name="doc" size="sm" aria-hidden="true" />
          </span>
        )}
        <span className="flex flex-col gap-0.5 flex-1 min-w-0 text-left">
          <span className="av-sec-label">{title}</span>
          <span className="u-small truncate">{caption}</span>
        </span>
        {/* Two distinct flags: red cross = a course that can't count here at
            all; amber triangle = one that counts here but is excluded from the
            top bar until its prereq/antireq is resolved. */}
        {excludedViolationCount > 0 ? (
          <span
            role="img"
            className="inline-flex items-center gap-0.5 rounded-full bg-danger-soft text-danger px-1.5 py-0.5 text-[10px] font-medium tabular-nums shrink-0"
            aria-label={`${excludedViolationCount} placed ${pluralize(excludedViolationCount, "course")} excluded — can't count toward this requirement`}
            title={`${excludedViolationCount} placed ${pluralize(excludedViolationCount, "course")} can't count toward this requirement (excluded by the rule)`}
          >
            <Icon name="close" size="xs" aria-hidden="true" />
            {excludedViolationCount}
          </span>
        ) : null}
        {legalityIssueCount > 0 ? (
          <span
            role="img"
            className="inline-flex items-center gap-0.5 rounded-full bg-partial-soft text-partial px-1.5 py-0.5 text-[10px] font-medium tabular-nums shrink-0"
            aria-label={`${countNoun(legalityIssueCount, "course")} flagged — placed before prereqs or in antireq conflict`}
            title={`${countNoun(legalityIssueCount, "course")} here ${pluralize(legalityIssueCount, "is", "are")} placed before prereqs or in antireq conflict — shown on this row, but excluded from the degree bar until fixed`}
          >
            <Icon name="warning" size="xs" aria-hidden="true" />
            {legalityIssueCount}
          </span>
        ) : null}
        <span className="text-ink-3 inline-flex transition-transform group-open:rotate-90 shrink-0">
          <Icon name="chevronRight" size="xs" aria-hidden="true" />
        </span>
      </summary>
      <div className="av-row-body">{children}</div>
    </details>
  );
}
