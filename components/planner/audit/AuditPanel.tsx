"use client";

import { Fragment, memo, type ReactNode, useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import {
  type Averages,
  computeAverages,
  MIN_GRADED_FOR_AVERAGE,
} from "@/lib/audit/averages";
import {
  type BreadthRequirement,
  nonBreadthConstraints,
} from "@/lib/audit/breadth";
import { deriveCommunicationRequirement } from "@/lib/audit/communication";
import {
  type AuditNode,
  type AuditRoot,
  compileAudit,
  legalityKeySet,
  placementLegalityKey,
  summarize,
} from "@/lib/audit/compile";
import {
  deriveElectiveSections,
  type ElectiveSection,
  subjectPoolEligible as electivePoolEligible,
} from "@/lib/audit/electives";
import { isLevelFloor, type LevelFloor } from "@/lib/audit/levelFloors";
import { computeDegreeProgress } from "@/lib/audit/progress";
import type { Course, FilterPreset } from "@/lib/courses/types";
import { formatCourseCode } from "@/lib/format";
import { courseDragProps } from "@/lib/plan/dnd";
import type { LocalPlan } from "@/lib/plan/types";
import { validatePlan } from "@/lib/plan/validate";
import {
  describeRule,
  PROGRAMS,
  type Program,
  type SubjectPoolNode,
  TERM_LETTERS,
} from "@/lib/programs";

/**
 * Drag wiring for course rows / option chips, owned by the planner shell.
 * `draggingCode` is the code in flight (dims its row); `onStart`/`onEnd` bracket
 * the drag. Absent in the read-only shared view.
 */
interface DragWiring {
  draggingCode: string | null;
  onStart: (code: string) => void;
  onEnd: () => void;
}

/**
 * Opens the slot picker for a requirement. `codes` focuses specific courses (a
 * finite list / a single "Add"); `preset` instead seeds the picker's filters —
 * a subject pool passes its subjects (as an `includePrefixes` allow-list) and
 * level range, so the catalog narrows live and the sidebar shows the filter.
 */
export type DrillFn = (codes: string[], preset?: FilterPreset) => void;

interface Props {
  plan: LocalPlan;
  /**
   * Course catalog, used for row titles and to resolve a subject pool's
   * eligible codes for Browse. Optional — when absent (read-only contexts that
   * don't pass it) rows fall back to code-only and pool Browse is unavailable.
   */
  catalog?: Course[];
  /**
   * A single "Add" passes one code → the term picker; a multi-code "Browse"
   * (open pool / elective) opens the slot picker pre-filtered to those codes.
   * Optional — the read-only shared view passes nothing, leaving rows inert.
   */
  onDrillToRequirement?: DrillFn;
  /** Drag lifecycle for course rows; omitted alongside the read-only view. */
  drag?: DragWiring;
}

interface SectionSummary {
  needed: number;
  satisfied: number;
  excludedViolationCount: number;
}

/**
 * A renderable audit section. `node` sections (terms, flexible groups,
 * specialization groups) carry a compiled `AuditNode`; the two `elective*`
 * kinds are derived from `program.electives[]`, which is not part of the rule
 * tree.
 */
type Section =
  | {
      kind: "node";
      key: string;
      title: string;
      caption: string;
      node: AuditNode;
      summary: SectionSummary;
    }
  | {
      kind: "electiveFinite";
      key: string;
      title: string;
      caption: string;
      need: number;
      placed: number;
      options: string[];
    }
  | {
      kind: "electiveBrowse";
      key: string;
      title: string;
      caption: string;
      eligibleCodes: string[];
      unitBased: boolean;
    }
  | {
      kind: "breadth";
      key: string;
      title: string;
      caption: string;
      /** Units required / placed (the calendar states breadth in units). */
      needUnits: number;
      placedUnits: number;
      subjects: string[];
      satisfiers: string[];
    }
  | {
      kind: "levelFloor";
      key: string;
      title: string;
      caption: string;
      /** Units required / placed (a unit-based minimum, not a course count). */
      needUnits: number;
      placedUnits: number;
      /** Subject prefixes that scope it (uppercase); empty = any subject. */
      subjects: string[];
      satisfiers: string[];
      sourceText: string;
    }
  | {
      kind: "info";
      key: string;
      title: string;
      caption: string;
    };

/** One of the top-level collapsible macro-sections. */
type MacroKey = "degree" | "specialization" | "electives" | "other";

/**
 * A stratum within a macro: an optional light sub-heading over either a
 * flattened rule-tree node (rendered as direct rows) or a list of existing
 * Section objects (breadth, level floors, electives, info) rendered as rows.
 */
interface MacroBlock {
  subLabel: string | null;
  content:
    | { kind: "node"; node: AuditNode }
    | { kind: "sections"; sections: Section[] };
}

interface Macro {
  key: MacroKey;
  label: string;
  /** Course-count progress for the header chip; null for informational macros. */
  count: { satisfied: number; needed: number } | null;
  /** "+N to plan" hint for elective volume the count can't measure. */
  hint: string | null;
  blocks: MacroBlock[];
  defaultOpen: boolean;
}

/** Units as a compact string: trims trailing zeros (20.0→"20", 13.5→"13.5"). */
function fmtUnits(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * The generic `all` description (`describeRule`'s fallback). It carries no
 * information, so it's never shown as a sub-label — flattening a section reads
 * the requirements directly instead of under a "Complete all of the following".
 */
const GENERIC_ALL = "Complete all of the following";

export const AuditPanel = memo(function AuditPanel({
  plan,
  catalog,
  onDrillToRequirement,
  drag,
}: Props) {
  const program = plan.programId ? (PROGRAMS[plan.programId] ?? null) : null;

  const catalogByCode = useMemo(
    () => new Map((catalog ?? []).map((c) => [c.code, c])),
    [catalog],
  );

  // Legality overlay: a satisfier placed before its prereqs (or in antireq
  // conflict) still counts toward its requirement, but is flagged. Needs the
  // catalog to read requisite strings; without it (read-only view) the overlay
  // is simply empty. `blockingIssueCount` is the plan-wide rollup for the header.
  const { legality, blockingIssueCount } = useMemo(() => {
    if (catalogByCode.size === 0)
      return { legality: new Set<string>(), blockingIssueCount: 0 };
    const issues = validatePlan(plan, catalogByCode);
    const keys = legalityKeySet(issues);
    return { legality: keys, blockingIssueCount: keys.size };
  }, [plan, catalogByCode]);

  const audit = useMemo(
    () => compileAudit(program, plan, plan.specializationId, legality),
    [plan, program, legality],
  );

  // Unit-weighted percentage averages (Waterloo reports percent, not GPA).
  // Needs the catalog for unit weights; without it the values stay null.
  const averages = useMemo(
    () => computeAverages(plan, catalogByCode, audit),
    [plan, catalogByCode, audit],
  );

  const progress = useMemo(
    () =>
      computeDegreeProgress(
        audit,
        program,
        (code) => catalogByCode.get(code)?.units ?? 0.5,
        legality,
      ),
    [audit, program, catalogByCode, legality],
  );

  const unitsOf = useMemo(
    () => (code: string) => catalogByCode.get(code)?.units ?? 0.5,
    [catalogByCode],
  );

  const { macros, unverifiedCount } = useMemo(
    () =>
      deriveMacros(
        audit,
        program,
        progress.freeUnits,
        progress.breadthRequirements,
        progress.levelFloors,
        unitsOf,
      ),
    [
      audit,
      program,
      progress.freeUnits,
      progress.breadthRequirements,
      progress.levelFloors,
      unitsOf,
    ],
  );

  if (!plan.programId) {
    return (
      <aside className="w-full lg:w-80 shrink-0 card-2 border-dashed px-4 py-6 text-sm text-ink-3">
        Pick a program to see your degree audit.
      </aside>
    );
  }
  if (!program) {
    return (
      <aside className="w-full lg:w-80 shrink-0 card px-4 py-6 text-sm text-partial">
        Unknown program: {plan.programId}
      </aside>
    );
  }

  // One honest headline: how much of the whole degree (every course it takes,
  // not a sum of overlapping requirement slots) the plan accounts for. The
  // denominator is the degree's authoritative size (totalUnits ÷ 0.5); the
  // numerator credits each placed course to at most one requirement, capped at
  // that size, and is held below 100% until every requirement is genuinely met.
  const headlinePct = progress.pct;
  // When the calendar states no degree total (e.g. Joint Honours, which split
  // units across two plans) the denominator falls back to the sum of structured
  // requirements — an estimate, not the authoritative size. Mark it so the
  // number isn't read as exact.
  const estimatedDenom = progress.totalUnits == null;
  const headlineFraction = `${fmtUnits(progress.creditedUnits)}/${estimatedDenom ? "~" : ""}${fmtUnits(progress.denom)} units`;

  const placedCodes = new Set(audit.placement.keys());
  // Codes whose placement is illegal (placed before prereqs / antireq conflict).
  // They're in `placedCodes` (so the course still shows on its row) but flagged,
  // and excluded from the ring counts + the headline — see nodeProgress / the
  // header warning. Empty in the read-only view (no catalog → no legality).
  const illegalCodes = new Set<string>();
  for (const [code, p] of audit.placement)
    if (legality.has(placementLegalityKey(p))) illegalCodes.add(code);

  return (
    <aside className="w-full lg:w-80 shrink-0 lg:h-full lg:flex lg:flex-col">
      <div className="card overflow-hidden lg:flex-1 lg:min-h-0 lg:flex lg:flex-col">
        <div className="pw-audit-top">
          <div className="flex items-baseline justify-between gap-2">
            <span className="u-eyebrow">Degree audit</span>
            <span className="u-mono u-small">{headlineFraction}</span>
          </div>
          <div className="flex items-baseline gap-1.5 mt-2">
            <span className="text-[30px] font-bold tracking-tight leading-none">
              {headlinePct}%
            </span>
            <span className="u-small">of degree planned</span>
          </div>
          <div className="mp-bar mt-2">
            <span style={{ width: `${headlinePct}%` }} />
          </div>
          <div className="av-note">
            Whole degree, measured in units. The rings below track each
            requirement on its own.
          </div>
          {estimatedDenom ? (
            <div className="av-note">
              This program's calendar entry states no total unit count, so the
              denominator is estimated from its listed requirements.
            </div>
          ) : null}
          {unverifiedCount > 0 ? (
            <div className="av-note">
              {unverifiedCount} requirement{unverifiedCount === 1 ? "" : "s"}{" "}
              couldn't be auto-verified — check with your advisor.
            </div>
          ) : null}
          {blockingIssueCount > 0 ? (
            <div className="av-note text-partial">
              ⚠ {blockingIssueCount} placement issue
              {blockingIssueCount === 1 ? "" : "s"} (prereq/antireq) — those
              courses are excluded from the bar until fixed.
            </div>
          ) : null}
          <AveragesRow averages={averages} />
        </div>
        <div className="pw-audit-list lg:flex-1 lg:min-h-0 [scrollbar-width:thin]">
          {macros.map((macro) => (
            <MacroSection
              key={macro.key}
              macro={macro}
              placedCodes={placedCodes}
              illegalCodes={illegalCodes}
              catalog={catalog}
              catalogByCode={catalogByCode}
              onDrill={onDrillToRequirement}
              drag={drag}
            />
          ))}
        </div>
      </div>
    </aside>
  );
});

/**
 * Compact averages line in the audit header. Shows the unit-weighted
 * cumulative and major percentages once computable; while there are graded
 * courses but too few to be meaningful, it says so rather than showing a
 * misleading number. Renders nothing when no grades exist yet.
 */
function AveragesRow({ averages }: { averages: Averages }) {
  const { cumulative, major } = averages;
  if (cumulative.value === null) {
    if (cumulative.countedCourses === 0) return null;
    return (
      <div className="av-note">
        Averages available after {MIN_GRADED_FOR_AVERAGE} graded courses (
        {cumulative.countedCourses} so far).
      </div>
    );
  }
  return (
    <div className="av-note u-mono">
      Cumulative {cumulative.value}%
      {major.value !== null ? <> · Major {major.value}%</> : null}
    </div>
  );
}

function isIncomplete(section: Section): boolean {
  if (section.kind === "node")
    return section.summary.satisfied < section.summary.needed;
  if (section.kind === "electiveFinite") return section.placed < section.need;
  if (section.kind === "breadth")
    return section.placedUnits < section.needUnits - 1e-9;
  if (section.kind === "levelFloor")
    return section.placedUnits < section.needUnits - 1e-9;
  return false;
}

/**
 * Satisfied/needed for a node, EXCLUDING illegally-placed satisfiers — a course
 * placed before its prereqs (or in an antireq conflict) doesn't credit here, the
 * same way the header bar never credits it. Keeps every ring/count consistent
 * with the headline. (Legality is only populated when a catalog is present; the
 * read-only view has none, so this is a no-op there.)
 */
function nodeProgress(node: AuditNode): { needed: number; satisfied: number } {
  const s = summarize(node);
  const illegal = node.illegalSatisfiers?.length ?? 0;
  return { needed: s.needed, satisfied: Math.max(0, s.satisfied - illegal) };
}

/** Progress ring for a sub-labeled node block (a term, spec, named sub-group). */
function ringFor(node: AuditNode): {
  pct: number;
  num: number;
  optional: boolean;
} {
  const { needed, satisfied } = nodeProgress(node);
  const optional = needed === 0;
  return {
    pct: optional ? 0 : Math.min(Math.round((satisfied / needed) * 100), 100),
    num: satisfied,
    optional,
  };
}

/* -------------------------------- macros -------------------------------- */

/**
 * One of the three top-level collapsible macro-sections (Degree requirements /
 * Electives / Co-op & other). A `node` block renders the rule tree flat via
 * `NodeBody`; a `sections` block renders the existing Section rows inline.
 */
function MacroSection({
  macro,
  placedCodes,
  illegalCodes,
  catalog,
  catalogByCode,
  onDrill,
  drag,
}: { macro: Macro } & OptionRenderProps) {
  return (
    <details className="av-macro group/macro" open={macro.defaultOpen}>
      <summary className="av-macro-head list-none select-none [&::-webkit-details-marker]:hidden">
        <span className="av-macro-label">{macro.label}</span>
        {macro.count ? (
          <span className="av-macro-count u-mono">
            {macro.count.satisfied} / {macro.count.needed}
          </span>
        ) : null}
        <span className="av-macro-chev inline-flex transition-transform group-open/macro:rotate-90">
          <Icon name="chevronRight" size="xs" aria-hidden="true" />
        </span>
      </summary>
      <div className="av-macro-body">
        {macro.blocks.map((block, i) => {
          const body =
            block.content.kind === "node" ? (
              <NodeBody
                node={block.content.node}
                placedCodes={placedCodes}
                illegalCodes={illegalCodes}
                catalog={catalog}
                catalogByCode={catalogByCode}
                onDrill={onDrill}
                drag={drag}
              />
            ) : (
              block.content.sections.map((s) => (
                <SectionRow
                  key={s.key}
                  section={s}
                  open={isIncomplete(s)}
                  placedCodes={placedCodes}
                  illegalCodes={illegalCodes}
                  catalog={catalog}
                  catalogByCode={catalogByCode}
                  onDrill={onDrill}
                  drag={drag}
                />
              ))
            );
          // A sub-labeled block (a term, "Specialization", "Degree minimums", a
          // named rule sub-group) is independently collapsible, so long lists —
          // e.g. an engineering program's eight terms — can be folded away. A
          // node block also carries a small progress ring (completion at a glance).
          if (block.subLabel) {
            const ring =
              block.content.kind === "node"
                ? ringFor(block.content.node)
                : null;
            return (
              <details
                // biome-ignore lint/suspicious/noArrayIndexKey: blocks are derived deterministically
                key={i}
                className="group/strata"
                open
              >
                <summary className="av-substrata av-substrata-sum list-none select-none [&::-webkit-details-marker]:hidden">
                  {ring ? (
                    <span className="av-ring-wrap av-strata-ring">
                      <Ring
                        pct={ring.pct}
                        size={24}
                        stroke={3}
                        tone={ring.optional ? "neutral" : undefined}
                      />
                      <span className="av-ring-num">{ring.num}</span>
                    </span>
                  ) : null}
                  <span className="av-substrata-text">{block.subLabel}</span>
                  <span className="av-substrata-chev inline-flex transition-transform group-open/strata:rotate-90">
                    <Icon name="chevronRight" size="xs" aria-hidden="true" />
                  </span>
                </summary>
                <div className="av-substrata-body">{body}</div>
              </details>
            );
          }
          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: blocks are derived deterministically
              key={i}
              className="av-macro-block"
            >
              {body}
            </div>
          );
        })}
        {macro.hint ? (
          <p className="av-hint av-macro-hint">{macro.hint}</p>
        ) : null}
      </div>
    </details>
  );
}

/* ------------------------------- sections ------------------------------- */

function SectionRow({
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
    // An optional group ("Choose any of the following", needed === 0) has no
    // target, so the ring reflects what's actually *chosen*: grey 0 with
    // nothing placed, and a green count once the student picks from the list
    // (any choice satisfies an optional group). Required groups (needed > 0)
    // keep their normal progress ring.
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
        // An optional group has no target, so a pick shouldn't read as a
        // completed *required* group: tag it "(optional)" AND render its ring in
        // a neutral tone (not the green that means "requirement met").
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
    // Breadth is unit-based ("1.0 unit of Humanities"); the ring fills on units,
    // the number shows how many placed courses currently contribute.
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
    // units; the number shows how many placed courses currently contribute.
    // Static row — the expandable body only restated the requirement (no
    // courses to drag), so there's nothing useful behind a dropdown.
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

  // electiveBrowse. When we have a concrete eligible list, show it as draggable
  // chips (no count target → neutral grey ring). Only when there's genuinely no
  // fixed list (unit-based / open pool) do we fall back to "browse the catalog".
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
        {/* Two distinct flags, kept visually separate (a red "excluded" cross vs
            an amber "flagged" triangle) so they don't read as contradictory: the
            red pill is a course that can't count here at all; the amber one is a
            course that does count on this row but is excluded from the top bar
            until its prereq/antireq is resolved. */}
        {excludedViolationCount > 0 ? (
          <span
            role="img"
            className="inline-flex items-center gap-0.5 rounded-full bg-danger-soft text-danger px-1.5 py-0.5 text-[10px] font-medium tabular-nums shrink-0"
            aria-label={`${excludedViolationCount} placed course${excludedViolationCount === 1 ? "" : "s"} excluded — can't count toward this requirement`}
            title={`${excludedViolationCount} placed course${excludedViolationCount === 1 ? "" : "s"} can't count toward this requirement (excluded by the rule)`}
          >
            <Icon name="close" size="xs" aria-hidden="true" />
            {excludedViolationCount}
          </span>
        ) : null}
        {legalityIssueCount > 0 ? (
          <span
            role="img"
            className="inline-flex items-center gap-0.5 rounded-full bg-partial-soft text-partial px-1.5 py-0.5 text-[10px] font-medium tabular-nums shrink-0"
            aria-label={`${legalityIssueCount} course${legalityIssueCount === 1 ? "" : "s"} flagged — placed before prereqs or in antireq conflict`}
            title={`${legalityIssueCount} course${legalityIssueCount === 1 ? "" : "s"} here ${legalityIssueCount === 1 ? "is" : "are"} placed before prereqs or in antireq conflict — shown on this row, but excluded from the degree bar until fixed`}
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

/* -------------------------------- bodies -------------------------------- */

/**
 * Renders an audit node's body, dispatching on the rule-node kind so each gets
 * the right treatment: required `courses` → draggable rows; `pick` → a "choose
 * one" row; `subjectPool` → Browse (no drag); nested `all` → recurse.
 */
function NodeBody({
  node,
  placedCodes,
  illegalCodes,
  catalog,
  catalogByCode,
  onDrill,
  drag,
  depth = 0,
}: {
  node: AuditNode;
  placedCodes: ReadonlySet<string>;
  illegalCodes: ReadonlySet<string>;
  catalog?: Course[];
  catalogByCode: Map<string, Course>;
  onDrill?: DrillFn;
  drag?: DragWiring;
  depth?: number;
}) {
  const r = node.ruleNode;

  if (r.kind === "courses") {
    return (
      <>
        {r.courses.map((code) => (
          <CourseRow
            key={code}
            code={code}
            placed={placedCodes.has(code)}
            illegal={illegalCodes.has(code)}
            catalogByCode={catalogByCode}
            onDrill={onDrill}
            drag={drag}
          />
        ))}
      </>
    );
  }

  if (r.kind === "pick") {
    // The clean case: a 1-of-N choice over `courses` leaves. The compiler
    // unions those into one option pool (so `node.children` is empty and the
    // options live on `node.ruleNode.children`) — render a "choose one" row.
    // This mirrors the compiler's own `allCoursesLeaves` test exactly.
    const allCourses =
      r.children.length > 0 && r.children.every((c) => c.kind === "courses");
    if (allCourses) {
      const options = [
        ...new Set(
          r.children.flatMap((c) => (c.kind === "courses" ? c.courses : [])),
        ),
      ];
      return (
        <ChooseOneRow
          node={node}
          options={options}
          catalogByCode={catalogByCode}
          onDrill={onDrill}
          drag={drag}
        />
      );
    }
    // A 1-of-1 pick whose options are all individual courses — even when nested
    // ("AMATH 271, or one of {AMATH 333, …}") — is mathematically a single flat
    // choice: any one course satisfies it. Collapse it into one "choose one"
    // card rather than a course row + a nested choice card.
    const flat = asFlatChoiceOptions(node);
    if (flat && flat.length > 0) {
      return (
        <ChooseOneRow
          node={node}
          options={flat}
          catalogByCode={catalogByCode}
          onDrill={onDrill}
          drag={drag}
        />
      );
    }
    // Genuinely compound pick (each option requires several courses, an open
    // pool, etc.): render the alternatives as clearly-delineated option cards
    // so they read as mutually-exclusive choices, not independent requirements
    // — and collapse to a summary once the choice is satisfied.
    return (
      <CompoundPickBody
        node={node}
        placedCodes={placedCodes}
        illegalCodes={illegalCodes}
        catalog={catalog}
        catalogByCode={catalogByCode}
        onDrill={onDrill}
        drag={drag}
        depth={depth}
      />
    );
  }

  if (r.kind === "subjectPool") {
    return <SubjectPoolBody node={r} onDrill={onDrill} />;
  }

  if (r.kind === "all") {
    // A nested sub-group shows its own framing heading; the top-level group's
    // framing is already the section title. Children render their own headings,
    // so the parent never adds one (which would double up on mixed picks).
    return (
      <div className="flex flex-col gap-1.5">
        {depth > 0 && node.description && node.description !== GENERIC_ALL ? (
          <span className="u-small mt-1">{node.description}</span>
        ) : null}
        {node.children.map((child, i) => (
          <NodeBody
            // biome-ignore lint/suspicious/noArrayIndexKey: rule tree is stable
            key={i}
            node={child}
            placedCodes={placedCodes}
            illegalCodes={illegalCodes}
            catalog={catalog}
            catalogByCode={catalogByCode}
            onDrill={onDrill}
            drag={drag}
            depth={depth + 1}
          />
        ))}
      </div>
    );
  }

  // excluded: violations surface as the section pill, no body.
  return null;
}

/* --------------------- compound pick (option cards) --------------------- */

/** When true, a satisfied compound pick collapses to a summary + "show others". */
const COLLAPSE_WHEN_DECIDED = true;

/** Props every option-card piece needs to render (and recurse via NodeBody). */
interface OptionRenderProps {
  placedCodes: ReadonlySet<string>;
  /** Placed codes whose placement is illegal (prereq/antireq) — flagged, uncounted. */
  illegalCodes: ReadonlySet<string>;
  catalog?: Course[];
  catalogByCode: Map<string, Course>;
  onDrill?: DrillFn;
  drag?: DragWiring;
}

/** Does this option's placement actually satisfy it (vs. a vacuous "met")? */
function optionMet(opt: AuditNode): boolean {
  return (
    (opt.status === "met" || opt.status === "overSatisfied") &&
    opt.satisfiers.length > 0
  );
}

/** A→Z badge for an option's position in the choice. */
function optionBadge(index: number): string {
  return String.fromCharCode(65 + index);
}

/**
 * A compound `pick` whose options are multi-course bundles. Renders each
 * alternative as a delineated option card so they read as mutually-exclusive
 * choices; once enough options are satisfied it collapses to a compact summary
 * of the completed path with a "show other options" toggle.
 */
function CompoundPickBody({
  node,
  depth,
  ...rest
}: {
  node: AuditNode;
  depth: number;
} & OptionRenderProps) {
  const r = node.ruleNode;
  const [showAll, setShowAll] = useState(false);
  // Local "which option am I considering" focus — it only drives which card is
  // expanded; placement alone decides what's actually satisfied, so it needs no
  // persistence. Default to the option already in progress, else the first.
  const options = r.kind === "pick" ? node.children : [];
  const [focused, setFocused] = useState(() => initialFocus(options));
  if (r.kind !== "pick") return null;

  const selectMin = r.selectMin ?? 1;
  const metOptions = options
    .map((opt, index) => ({ opt, index }))
    .filter(({ opt }) => optionMet(opt));
  const decided = metOptions.length >= selectMin;

  if (COLLAPSE_WHEN_DECIDED && decided && !showAll) {
    return (
      <CompoundPickSummary
        metOptions={metOptions}
        total={options.length}
        onShowAll={() => setShowAll(true)}
      />
    );
  }

  return (
    <div className="av-choice">
      {/* A top-level compound pick (rare; none in current data) already has the
          framing as its section title, so only nested ones add the header. */}
      {depth > 0 ? (
        <div className="av-choice-head">{pickFraming(r, options.length)}</div>
      ) : null}
      <div className="av-choice-opts">
        {options.map((opt, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rule tree is stable
          <Fragment key={i}>
            {i > 0 ? <div className="av-choice-or">or</div> : null}
            <ChoiceOption
              option={opt}
              index={i}
              expanded={i === focused}
              onSelect={() => setFocused(i)}
              {...rest}
            />
          </Fragment>
        ))}
      </div>
      {decided ? (
        <button
          type="button"
          className="av-opt-toggle"
          onClick={() => setShowAll(false)}
        >
          Hide other options
        </button>
      ) : null}
    </div>
  );
}

/** Pick the option to expand first: one in progress, else a met one, else A. */
function initialFocus(options: AuditNode[]): number {
  const partial = options.findIndex((o) => o.status === "partial");
  if (partial >= 0) return partial;
  const met = options.findIndex(optionMet);
  return met >= 0 ? met : 0;
}

/** A one-line glance at a collapsed option: its course codes (+ pool/extra). */
function optionPreviewText(opt: AuditNode): string {
  const codes: string[] = [];
  let pools = 0;
  const walk = (n: AuditNode) => {
    const r = n.ruleNode;
    if (r.kind === "courses") codes.push(...r.courses);
    else if (r.kind === "subjectPool") pools += r.selectCount ?? 1;
    else n.children.forEach(walk);
  };
  walk(opt);
  const uniq = [...new Set(codes)];
  const parts = uniq.slice(0, 3).map(formatCourseCode);
  const extra = uniq.length - parts.length;
  if (extra > 0) parts.push(`+${extra}`);
  if (pools > 0) parts.push(`+${pools} course${pools === 1 ? "" : "s"}`);
  return parts.join("  ·  ") || "—";
}

/**
 * One alternative in a compound pick. Collapsed, it's a single selectable row
 * (radio badge + a preview of its courses); selecting it expands the full
 * requirement body and collapses the siblings, so the group reads as an active
 * "pick one of these" rather than a stack of competing cards.
 */
function ChoiceOption({
  option,
  index,
  expanded,
  onSelect,
  ...rest
}: {
  option: AuditNode;
  index: number;
  expanded: boolean;
  onSelect: () => void;
} & OptionRenderProps) {
  const met = optionMet(option);
  const cls = `av-choice-opt${expanded ? " is-open" : ""}${met ? " is-met" : ""}`;
  return (
    <div className={cls}>
      <button
        type="button"
        className="av-choice-sel"
        onClick={onSelect}
        aria-expanded={expanded}
      >
        <span className="av-choice-radio">
          {met ? (
            <Icon name="check" size="sm" aria-hidden="true" />
          ) : (
            optionBadge(index)
          )}
        </span>
        {expanded ? (
          <span className="av-choice-open-label">
            Option {optionBadge(index)}
          </span>
        ) : (
          <span className="av-choice-preview">{optionPreviewText(option)}</span>
        )}
        {expanded ? null : (
          <span className="av-choice-chev">
            <Icon name="chevronRight" size="xs" aria-hidden="true" />
          </span>
        )}
      </button>
      {/* The body is ALWAYS in the DOM — every option's courses stay present
          (data integrity + reachable), just hidden when this option isn't the
          expanded one. Conditional-rendering it would silently drop those codes
          from the rendered audit. */}
      <div className="av-choice-body" hidden={!expanded}>
        <OptionBody node={option} {...rest} />
      </div>
    </div>
  );
}

/**
 * The body of an option card. An option is usually an `all` bundle — render its
 * children directly so the card boundary stands in for "Complete all of the
 * following". A non-`all` option (a bare multi-code courses leaf, or a single
 * nested pick) renders as-is.
 */
function OptionBody({
  node,
  ...rest
}: { node: AuditNode } & OptionRenderProps) {
  if (node.ruleNode.kind === "all") {
    return (
      <div className="flex flex-col gap-1.5">
        {node.children.map((child, i) => (
          <NodeBody
            // biome-ignore lint/suspicious/noArrayIndexKey: rule tree is stable
            key={i}
            node={child}
            depth={1}
            {...rest}
          />
        ))}
      </div>
    );
  }
  return <NodeBody node={node} depth={1} {...rest} />;
}

/** Collapsed view of a satisfied compound pick: the completed path(s) + toggle. */
function CompoundPickSummary({
  metOptions,
  total,
  onShowAll,
}: {
  metOptions: { opt: AuditNode; index: number }[];
  total: number;
  onShowAll: () => void;
}) {
  const others = total - metOptions.length;
  return (
    <div className="flex flex-col gap-1.5">
      {metOptions.map(({ opt, index }) => (
        <div key={index} className="av-opt-summary">
          <span className="av-opt-summary-mark">
            <Icon name="check" size="sm" aria-hidden="true" />
          </span>
          <span className="av-opt-summary-body">
            <span className="av-opt-summary-label">
              Completed — Option {optionBadge(index)}
            </span>
            <span className="av-opt-summary-codes">
              {[...new Set(opt.satisfiers.map((s) => s.code))]
                .map(formatCourseCode)
                .join(" + ")}
            </span>
          </span>
        </div>
      ))}
      {others > 0 ? (
        <button type="button" className="av-opt-toggle" onClick={onShowAll}>
          <Icon name="chevronRight" size="xs" aria-hidden="true" /> show{" "}
          {others} other option{others === 1 ? "" : "s"}
        </button>
      ) : null}
    </div>
  );
}

/**
 * A required course. Placed → met-styled row with a check. Unplaced and
 * interactive → draggable row with a grip + "Add". Read-only → inert row.
 */
function CourseRow({
  code,
  placed,
  illegal,
  catalogByCode,
  onDrill,
  drag,
}: {
  code: string;
  placed: boolean;
  /** Placed, but illegally (unmet prereq / antireq conflict) — flag, don't credit. */
  illegal?: boolean;
  catalogByCode: Map<string, Course>;
  onDrill?: DrillFn;
  drag?: DragWiring;
}) {
  const label = formatCourseCode(code);
  const title = catalogByCode.get(code)?.name ?? "";

  if (placed) {
    // Placed-but-illegal: keep the row (it IS in the plan) but flag it amber and
    // explain — our ring/headline counts exclude it, so a plain green check would
    // read as "done" when it isn't credited yet.
    return (
      <div
        className={`av-item ${illegal ? "flagged" : "met"}`}
        title={
          illegal
            ? `${label} is placed before its prereqs or in an antireq conflict — it shows on your timeline, but doesn't credit the degree until the placement is valid.`
            : undefined
        }
      >
        <span className={`av-item-grip ${illegal ? "flagged" : "met"}`}>
          <Icon
            name={illegal ? "warning" : "check"}
            size="sm"
            aria-hidden="true"
          />
        </span>
        <span className="flex flex-col gap-px min-w-0 flex-1">
          <span className="u-mono av-item-code">{label}</span>
          {title ? <span className="av-item-name">{title}</span> : null}
        </span>
      </div>
    );
  }

  if (!onDrill) {
    return (
      <div className="av-item">
        <span className="flex flex-col gap-px min-w-0 flex-1">
          <span className="u-mono av-item-code">{label}</span>
          {title ? <span className="av-item-name">{title}</span> : null}
        </span>
      </div>
    );
  }

  const isPlacing = drag?.draggingCode === code;
  return (
    <div
      className={`av-item drag${isPlacing ? " dim" : ""}`}
      {...courseDragProps(
        { kind: "add", code },
        drag
          ? { onStart: () => drag.onStart(code), onEnd: () => drag.onEnd() }
          : undefined,
      )}
    >
      <span className="av-item-grip">
        <Grip />
      </span>
      <span className="flex flex-col gap-px min-w-0 flex-1">
        <span className="u-mono av-item-code">{label}</span>
        {title ? <span className="av-item-name">{title}</span> : null}
      </span>
      <button
        type="button"
        className="av-item-add"
        onClick={() => onDrill([code])}
        title={`Drag ${label} into a term, or click to pick one`}
        aria-label={`Add ${label} to a term`}
      >
        Add <Icon name="arrow" size="xs" aria-hidden="true" />
      </button>
    </div>
  );
}

/** A concise "Choose N …" framing for a nested mixed pick's alternatives. */
function pickFraming(
  r: Extract<AuditNode["ruleNode"], { kind: "pick" }>,
  optionCount?: number,
): string {
  const min = r.selectMin;
  const max = r.selectMax;
  // With a known option count and an exact N-of-M choice, name the total:
  // "Choose 1 of 3 options" reads better than "Choose 1 of these options:".
  if (optionCount != null && min != null && max != null && min === max)
    return `Choose ${min} of ${optionCount} options`;
  if (min != null && max != null)
    return min === max
      ? `Choose ${min} of these options:`
      : `Choose ${min}–${max} of these options:`;
  if (max != null) return `Choose up to ${max} of these options:`;
  if (min != null) return `Choose at least ${min} of these options:`;
  return "Choose from these options:";
}

/**
 * Collapse a 1-of-1 pick whose every leaf is a single course into a flat list
 * of option codes — even across nested 1-of-1 picks. Returns `null` when an
 * option is genuinely compound (requires several courses, is an open subject
 * pool, or the pick isn't a strict 1-of-1), so the caller keeps the structured
 * rendering. Mirrors the compiler's option semantics: a `courses` leaf directly
 * under a pick contributes each of its codes as a separate option, but a
 * `courses` leaf reached as a mixed pick's compiled child means "all of these"
 * and so can't be a single chip.
 */
function asFlatChoiceOptions(node: AuditNode): string[] | null {
  const r = node.ruleNode;
  if (r.kind === "courses")
    return r.courses.length === 1 ? [r.courses[0]] : null;
  if (r.kind !== "pick") return null;
  if ((r.selectMin ?? 1) !== 1 || (r.selectMax ?? 1) !== 1) return null;
  const opts: string[] = [];
  if (node.children.length === 0) {
    // All-courses pick the compiler unioned: each code is its own option.
    for (const c of r.children) {
      if (c.kind !== "courses") return null;
      opts.push(...c.courses);
    }
  } else {
    for (const child of node.children) {
      const sub = asFlatChoiceOptions(child);
      if (!sub) return null;
      opts.push(...sub);
    }
  }
  return [...new Set(opts)];
}

/** A pick(1-of-N) requirement: marker + label + the option pool as chips. */
function ChooseOneRow({
  node,
  options,
  catalogByCode,
  onDrill,
  drag,
}: {
  node: AuditNode;
  options: string[];
  catalogByCode: Map<string, Course>;
  onDrill?: DrillFn;
  drag?: DragWiring;
}) {
  const r = node.ruleNode;
  if (r.kind !== "pick") return null;
  // `selectMin` is absent for "choose any" / "no more than N" picks, which the
  // compiler reports as vacuously met. Only collapse to the chosen chip(s) once
  // a placement actually satisfies the choice — otherwise keep showing the
  // options (a vacuously-met optional pick has none, and would render empty).
  const decided =
    (node.status === "met" || node.status === "overSatisfied") &&
    node.satisfiers.length > 0;
  const selectMin = r.selectMin ?? 0;
  const label =
    selectMin === 1 && (r.selectMax ?? 1) === 1
      ? "Choose one"
      : (describeRule(r) ?? "Choose one");
  const satisfierCodes = new Set(node.satisfiers.map((s) => s.code));

  return (
    <div className={`av-choose${decided ? " is-met" : ""}`}>
      <span className="av-choose-mark">
        {decided ? (
          <Icon name="check" size="xs" aria-hidden="true" />
        ) : (
          <span className="av-need">{selectMin > 0 ? selectMin : "+"}</span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="av-choose-label">{label}</div>
        <div className="av-chips mt-1.5">
          {decided
            ? node.satisfiers.map((s) => (
                <span key={s.code} className="av-chip met">
                  <Icon name="check" size="xs" aria-hidden="true" />
                  {formatCourseCode(s.code)}
                </span>
              ))
            : options.map((code) => (
                <OptionChip
                  key={code}
                  code={code}
                  placed={satisfierCodes.has(code)}
                  catalogByCode={catalogByCode}
                  onDrill={onDrill}
                  drag={drag}
                />
              ))}
        </div>
      </div>
    </div>
  );
}

/** A draggable option chip (pick options + finite elective pools). */
function OptionChip({
  code,
  placed,
  catalogByCode,
  onDrill,
  drag,
}: {
  code: string;
  placed: boolean;
  catalogByCode: Map<string, Course>;
  onDrill?: DrillFn;
  drag?: DragWiring;
}) {
  const label = formatCourseCode(code);
  const title = catalogByCode.get(code)?.name;
  const tip = title ? `${label} — ${title}` : label;

  if (placed) {
    return (
      <span className="av-chip met" title={tip}>
        <Icon name="check" size="xs" aria-hidden="true" />
        {label}
      </span>
    );
  }
  if (!onDrill) {
    return (
      <span className="av-chip" title={tip}>
        {label}
      </span>
    );
  }
  const isPlacing = drag?.draggingCode === code;
  return (
    <button
      type="button"
      className={`av-chip drag${isPlacing ? " dim" : ""}`}
      onClick={() => onDrill([code])}
      title={`${tip} · drag into a term`}
      {...courseDragProps(
        { kind: "add", code },
        drag
          ? { onStart: () => drag.onStart(code), onEnd: () => drag.onEnd() }
          : undefined,
      )}
    >
      <span className="av-grip">
        <Grip s={11} />
      </span>
      {label}
    </button>
  );
}

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

/**
 * A criteria-based requirement (subject pool / faculty breadth) — defined by a
 * subject + level filter, not a fixed course list. Renders as one "search the
 * catalog" card summarizing the criteria; clicking it opens the picker
 * pre-filtered to those subjects/levels (so the sidebar shows the filter).
 * Placed courses that count show as met chips above.
 */
function PoolCard({
  lead,
  subjects,
  levelText,
  satisfiers,
  onBrowse,
}: {
  lead: string;
  subjects: string[];
  levelText: string | null;
  satisfiers: string[];
  onBrowse: (() => void) | null;
}) {
  const shown = subjects.slice(0, 3);
  const extra = subjects.length - shown.length;
  const sub = [shown.join(" · ") + (extra > 0 ? ` +${extra}` : ""), levelText]
    .filter(Boolean)
    .join("  ·  ");
  const inner = (
    <span className="av-poolbtn-text">
      <span className="av-poolbtn-lead">{lead}</span>
      {sub ? <span className="av-poolbtn-sub">{sub}</span> : null}
    </span>
  );
  return (
    <div className="av-pool">
      {satisfiers.length > 0 ? (
        <div className="av-chips">
          {satisfiers.map((code) => (
            <span
              key={code}
              className="av-chip met"
              title={formatCourseCode(code)}
            >
              <Icon name="check" size="xs" aria-hidden="true" />
              {formatCourseCode(code)}
            </span>
          ))}
        </div>
      ) : null}
      {onBrowse ? (
        <button type="button" className="av-poolbtn" onClick={onBrowse}>
          <span className="av-poolbtn-ico">
            <Icon name="search" size="sm" aria-hidden="true" />
          </span>
          {inner}
          <Icon name="arrow" size="xs" aria-hidden="true" />
        </button>
      ) : (
        <div className="av-poolbtn is-static">
          <span className="av-poolbtn-ico">
            <Icon name="search" size="sm" aria-hidden="true" />
          </span>
          {inner}
        </div>
      )}
    </div>
  );
}

/** An open subject pool: "choose N courses in these subjects/levels". */
function SubjectPoolBody({
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

/**
 * A breadth/distribution requirement ("1.0 unit of Humanities: CLAS, ENGL, …").
 * Criteria-based like a subject pool; placed courses in those subjects show met.
 */
function BreadthBody({
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

/* ------------------------------ primitives ------------------------------ */

/** SVG donut progress ring. Geometry per the design handoff. */
function Ring({
  pct,
  size = 34,
  stroke = 3.5,
  tone,
}: {
  pct: number;
  size?: number;
  stroke?: number;
  /** "neutral" → a muted (non-green) fill, for optional groups with no target. */
  tone?: "neutral";
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(pct, 100) / 100);
  const color =
    tone === "neutral"
      ? "var(--ink-3)"
      : pct >= 100
        ? "var(--met)"
        : pct > 0
          ? "var(--partial)"
          : "var(--missing)";
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ flex: "none" }}
      aria-hidden="true"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--bg-3)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset .4s ease" }}
      />
    </svg>
  );
}

/** Six-dot drag handle. The Icon registry has no grip glyph, so it's inline. */
function Grip({ s = 12 }: { s?: number }) {
  return (
    <svg
      className="av-grip"
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="9" cy="5" r="1.5" />
      <circle cx="15" cy="5" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="19" r="1.5" />
      <circle cx="15" cy="19" r="1.5" />
    </svg>
  );
}

/* ----------------------------- derivation ------------------------------ */

/**
 * Translate the compiled `AuditRoot` (+ the program's elective notes) into the
 * grouped section list the panel renders.
 *
 * - Engineering (`byTerm`): one section per term (1A–4B) with requirements.
 * - Flexible (`flexibleRoot`): the named requirement groups (`explodeRoot`).
 * - Both: `program.electives[]` appended as their own "Electives" group.
 * - `specializationRoot`: its own group.
 *
 * The headline percentage counts only count-based sections (terms, groups,
 * finite electives); open/unit electives have no honest count and are surfaced
 * in the header caption instead.
 */
/**
 * Flatten a rule-tree root into renderable blocks. The generic "Complete all of
 * the following" wrapper carries no information, so flatten *through* it (render
 * the whole root as one flat node body); only a meaningfully NAMED sub-group
 * ("Core Courses", "Design Project") is kept as a light sub-label.
 */
function flattenRuleRoot(root: AuditNode): MacroBlock[] {
  if (root.ruleNode.kind === "all" && root.children.length > 0) {
    const everyChildGeneric = root.children.every(
      (c) =>
        c.ruleNode.kind !== "all" ||
        c.description == null ||
        c.description === GENERIC_ALL,
    );
    if (everyChildGeneric)
      return [{ subLabel: null, content: { kind: "node", node: root } }];
    return root.children.map((c) => ({
      subLabel:
        c.ruleNode.kind === "all" &&
        c.description != null &&
        c.description !== GENERIC_ALL
          ? c.description
          : null,
      content: { kind: "node", node: c },
    }));
  }
  return [{ subLabel: null, content: { kind: "node", node: root } }];
}

/**
 * Translate the compiled `AuditRoot` (+ the program's elective/degree notes)
 * into the three top-level macro-sections the panel renders:
 *
 *  - Degree requirements — every required core course/choice, flattened out of
 *    the rule tree (engineering: per term; flexible: the rule tree), plus
 *    specialization, communication, and level-floor minimums.
 *  - Electives — `program.electives[]`, faculty breadth/distribution, and the
 *    free-elective volume note.
 *  - Co-op & other — co-op/PD and other informational notes, non-breadth
 *    constraints, and requirements the scraper couldn't structure.
 *
 * The header chip per macro is a course-ish count; the whole-degree unit
 * headline above is computed separately (see computeDegreeProgress) and is not
 * derived here.
 */
function deriveMacros(
  audit: AuditRoot,
  program: Program | null,
  /** Free-elective units from the unified headline model. */
  freeElectiveUnits: number,
  /** Scored breadth requirements (units) from the unified headline model. */
  breadthRequirements: BreadthRequirement[],
  /** Scored level-floor requirements from the unified headline model. */
  levelFloors: LevelFloor[],
  /** Units of a placed course (catalog-backed; default 0.5). */
  unitsOf: (code: string) => number,
): { macros: Macro[]; unverifiedCount: number } {
  const placedCodes = new Set(audit.placement.keys());

  // ---- Degree requirements: required core, flattened ----
  const degreeBlocks: MacroBlock[] = [];
  let degNeeded = 0;
  let degSatisfied = 0;

  if (audit.byTerm) {
    // Engineering: keep the per-term breakdown (term order is meaningful) as a
    // light sub-label over each term's flattened requirement rows.
    for (const t of TERM_LETTERS) {
      const node = audit.byTerm[t];
      if (!node) continue;
      const summary = nodeProgress(node);
      if (summary.needed === 0) continue;
      degNeeded += summary.needed;
      degSatisfied += summary.satisfied;
      degreeBlocks.push({
        subLabel: `Term ${t}`,
        content: { kind: "node", node },
      });
    }
  }
  if (audit.flexibleRoot) {
    for (const block of flattenRuleRoot(audit.flexibleRoot)) {
      if (block.content.kind === "node") {
        const s = nodeProgress(block.content.node);
        degNeeded += s.needed;
        degSatisfied += s.satisfied;
      }
      degreeBlocks.push(block);
    }
  }
  // Specialization is its own top-level macro (built into specBlocks), not part
  // of the Degree-requirements count.
  const specBlocks: MacroBlock[] = [];
  let specNeeded = 0;
  let specSatisfied = 0;
  if (audit.specializationRoot) {
    for (const block of flattenRuleRoot(audit.specializationRoot)) {
      if (block.content.kind === "node") {
        const s = nodeProgress(block.content.node);
        specNeeded += s.needed;
        specSatisfied += s.satisfied;
      }
      specBlocks.push(block);
    }
  }

  // Communication + level-floor minimums — degree-level course/unit minimums,
  // grouped under a quiet "Degree minimums" sub-label. Each met requirement
  // contributes 1/1 to the macro count (units don't map cleanly to a course
  // count, so floors/breadth are scored as a met boolean here).
  if (program) {
    const minima: Section[] = [];
    const comm = deriveCommunicationRequirement(program, placedCodes);
    if (comm && !comm.alreadyInTree) {
      degNeeded += comm.need;
      degSatisfied += Math.min(comm.placed, comm.need);
      minima.push({
        kind: "electiveFinite",
        key: "deg-comm",
        title: comm.title,
        caption: `${comm.placed} of ${comm.need} done · ${comm.options.map(formatCourseCode).join(" or ")}`,
        need: comm.need,
        placed: comm.placed,
        options: comm.options,
      });
    }
    levelFloors.forEach((f, i) => {
      const done = Math.min(f.placedUnits, f.need);
      const met = f.placedUnits >= f.need - 1e-9;
      degNeeded += 1;
      degSatisfied += met ? 1 : 0;
      const subjects = (f.subjects ?? []).map((s) => s.toUpperCase());
      minima.push({
        kind: "levelFloor",
        key: `floor-${i}`,
        title: f.title,
        caption: `${fmtUnits(done)} of ${fmtUnits(f.need)} units${subjects.length ? ` · ${subjects.length} subjects` : ""}`,
        needUnits: f.need,
        placedUnits: f.placedUnits,
        subjects,
        satisfiers: f.satisfiers,
        sourceText: f.sourceText,
      });
    });
    if (minima.length > 0)
      degreeBlocks.push({
        subLabel: "Degree minimums",
        content: { kind: "sections", sections: minima },
      });
  }

  // ---- Electives: program electives + faculty breadth + free-elective volume.
  // These fold into the Degree-requirements macro under an "Electives" sub-label
  // (electives ARE degree requirements). Browse / unit-based electives carry no
  // honest count → surfaced as a "+N to plan" hint on the macro.
  const electiveSections: Section[] = [];
  let elecNeeded = 0;
  let elecSatisfied = 0;
  let untrackedCount = 0;
  if (program) {
    deriveElectiveSections(program)
      .map((e, i) => toElectiveSection(e, i, placedCodes, unitsOf))
      .forEach((s) => {
        if (s.kind === "electiveFinite") {
          elecNeeded += s.need;
          elecSatisfied += Math.min(s.placed, s.need);
        } else if (s.kind === "breadth") {
          elecNeeded += 1;
          elecSatisfied += s.placedUnits >= s.needUnits - 1e-9 ? 1 : 0;
        } else {
          untrackedCount += 1;
        }
        electiveSections.push(s);
      });
    breadthRequirements.forEach((b, i) => {
      elecNeeded += 1;
      elecSatisfied += b.placedUnits >= b.needUnits - 1e-9 ? 1 : 0;
      electiveSections.push(breadthSection(b, i));
    });
    // Free electives — the degree's open volume AFTER the named requirements
    // above. The units live on this row (they describe only the free remainder),
    // never on the macro heading: a program with big named electives (BME's
    // "pick 7" technical electives) has a tiny free remainder, so a heading
    // "≈ 0.5 units" would badly understate the section.
    if (freeElectiveUnits > 0) {
      const u = Math.round(freeElectiveUnits * 100) / 100;
      electiveSections.push({
        kind: "info",
        key: "free-electives",
        title: "Free electives",
        caption: `≈ ${u} unit${u === 1 ? "" : "s"}, any subject — fills the degree beyond the named requirements above.`,
      });
    }
  }

  // ---- Co-op & other: co-op/PD and other informational notes, non-breadth
  // constraints, and requirements the scraper couldn't structure. Purely
  // informational (co-op/PD isn't modelled as trackable courses) → no count.
  const otherSections: Section[] = [];
  if (program) {
    nonBreadthConstraints(program)
      .filter((c) => !isLevelFloor(c))
      .forEach((c, i) => {
        otherSections.push({
          kind: "info",
          key: `constraint-${i}`,
          title: c.label,
          caption:
            c.sourceText && c.sourceText !== c.label
              ? c.sourceText
              : "Verify with your advisor.",
        });
      });
    const items = [
      ...(program.informational ?? []),
      ...(program.degreeRequirements?.informational ?? []),
    ];
    items.forEach((it, i) => {
      otherSections.push({
        kind: "info",
        key: `info-${i}`,
        title: it.label,
        caption: it.text,
      });
    });
  }
  const unverified = program?.unverifiedRequirements ?? [];
  unverified.forEach((text, i) => {
    otherSections.push({
      kind: "info",
      key: `unverified-${i}`,
      title: "Couldn't auto-verify",
      caption: text,
    });
  });

  const macros: Macro[] = [];
  if (degreeBlocks.length > 0)
    macros.push({
      key: "degree",
      label: "Degree requirements",
      count:
        degNeeded > 0 ? { satisfied: degSatisfied, needed: degNeeded } : null,
      hint: null,
      blocks: degreeBlocks,
      defaultOpen: true,
    });
  if (specBlocks.length > 0)
    macros.push({
      key: "specialization",
      label: "Specialization",
      count:
        specNeeded > 0
          ? { satisfied: specSatisfied, needed: specNeeded }
          : null,
      hint: null,
      blocks: specBlocks,
      defaultOpen: true,
    });
  if (electiveSections.length > 0)
    macros.push({
      key: "electives",
      label: "Electives",
      count:
        elecNeeded > 0
          ? { satisfied: elecSatisfied, needed: elecNeeded }
          : null,
      hint:
        untrackedCount > 0
          ? `+ ${untrackedCount} elective requirement${untrackedCount === 1 ? "" : "s"} to plan`
          : null,
      blocks: [
        {
          subLabel: null,
          content: { kind: "sections", sections: electiveSections },
        },
      ],
      defaultOpen: false,
    });
  if (otherSections.length > 0)
    macros.push({
      key: "other",
      label: "Co-op & other",
      count: null,
      hint: null,
      blocks: [
        {
          subLabel: null,
          content: { kind: "sections", sections: otherSections },
        },
      ],
      defaultOpen: false,
    });

  return { macros, unverifiedCount: unverified.length };
}

function toElectiveSection(
  e: ElectiveSection,
  index: number,
  placedCodes: ReadonlySet<string>,
  unitsOf: (code: string) => number,
): Section {
  if (e.kind === "finite") {
    const placed = e.options.filter((c) => placedCodes.has(c)).length;
    return {
      kind: "electiveFinite",
      key: `elec-${index}`,
      title: e.title,
      caption: `${Math.min(placed, e.need)} of ${e.need} done · ${e.options.length} approved courses`,
      need: e.need,
      placed,
      options: e.options,
    };
  }
  if (e.kind === "subjectPool") {
    // A trackable unit-based subject filter → render like breadth (ring + subject
    // tags) in units, counting any in-scope placed course.
    const satisfiers = [...placedCodes].filter((c) =>
      electivePoolEligible(c, e),
    );
    const placedUnits = satisfiers.reduce((sum, c) => sum + unitsOf(c), 0);
    const done = Math.min(placedUnits, e.needUnits);
    const met = placedUnits >= e.needUnits - 1e-9;
    return {
      kind: "breadth",
      key: `elec-${index}`,
      title: e.title,
      caption: `${met ? "✓ " : ""}${fmtUnits(done)} of ${fmtUnits(e.needUnits)} unit${e.needUnits === 1 ? "" : "s"} · ${e.subjects.length} subjects`,
      needUnits: e.needUnits,
      placedUnits,
      subjects: e.subjects.map((s) => s.toUpperCase()),
      satisfiers,
    };
  }
  return {
    kind: "electiveBrowse",
    key: `elec-${index}`,
    title: e.title,
    caption: e.unitBased
      ? "Measured in units — plan manually"
      : e.eligibleCodes.length > 0
        ? `Choose from ${e.eligibleCodes.length} eligible courses`
        : "Choose from this list",
    eligibleCodes: e.eligibleCodes,
    unitBased: e.unitBased,
  };
}

/** A tracked breadth requirement → renderable section (in units). */
function breadthSection(b: BreadthRequirement, index: number): Section {
  const done = Math.min(b.placedUnits, b.needUnits);
  const met = b.placedUnits >= b.needUnits - 1e-9;
  return {
    kind: "breadth",
    key: `breadth-${index}`,
    title: b.title,
    caption: `${met ? "✓ " : ""}${fmtUnits(done)} of ${fmtUnits(b.needUnits)} unit${b.needUnits === 1 ? "" : "s"} · ${b.subjects.length} subjects`,
    needUnits: b.needUnits,
    placedUnits: b.placedUnits,
    subjects: b.subjects,
    satisfiers: b.satisfiers,
  };
}
