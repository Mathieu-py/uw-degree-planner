"use client";

import { memo, type ReactNode, useMemo } from "react";
import { Icon } from "@/components/ui/Icon";
import {
  type AuditNode,
  type AuditRoot,
  compileAudit,
  summarize,
} from "@/lib/audit/compile";
import {
  deriveElectiveSections,
  type ElectiveSection,
} from "@/lib/audit/electives";
import { levelBucket } from "@/lib/courses/code";
import type { Course } from "@/lib/courses/types";
import { formatCourseCode } from "@/lib/format";
import { courseDragProps } from "@/lib/plan/dnd";
import type { LocalPlan } from "@/lib/plan/types";
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
  onDrillToRequirement?: (codes: string[]) => void;
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
      kind: "unitBucket";
      key: string;
      title: string;
      caption: string;
      appliedUnits: number;
      requiredUnits: number;
      status: "met" | "partial" | "unmet";
      /** True when the bucket's scope can't be verified — the student checks it
       * by hand, so it shows a manual-verification marker instead of a 0% ring. */
      unscoped: boolean;
    }
  | {
      kind: "info";
      key: string;
      title: string;
      caption: string;
    };

type NodeSection = Extract<Section, { kind: "node" }>;

interface SectionGroup {
  heading: string | null;
  sections: Section[];
}

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

  const audit = useMemo(
    () =>
      compileAudit(
        program,
        plan,
        plan.specializationId,
        (code) => catalogByCode.get(code)?.units,
      ),
    [plan, program, catalogByCode],
  );

  const { groups, totals, unitTotals, untrackedCount, headerCaption } = useMemo(
    () => deriveSections(audit, program),
    [audit, program],
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

  const trackedPct =
    totals.needed > 0
      ? Math.min(Math.round((totals.satisfied / totals.needed) * 100), 100)
      : 0;
  // The % only covers requirements we can honestly track (required courses +
  // finite electives). When count-less elective requirements remain (open or
  // unit-based lists the catalog can't measure), never let it read 100% — that
  // would imply the degree is done when electives are still owed.
  const pct = untrackedCount > 0 ? Math.min(trackedPct, 99) : trackedPct;

  // When the program has a unit plan, units are the authoritative metric (a
  // 0.25 lab ≠ a 1.0 course), so the headline reports degree-unit progress.
  const unitPct =
    unitTotals && unitTotals.required > 0
      ? Math.min(
          Math.round((unitTotals.applied / unitTotals.required) * 100),
          100,
        )
      : null;
  const headlinePct = unitPct ?? pct;
  const headlineFraction = unitTotals
    ? `${unitTotals.applied.toFixed(1)}/${unitTotals.required} units`
    : `${totals.satisfied}/${totals.needed}`;
  const headlineLabel = unitTotals ? "of degree units" : "requirements met";

  // Default-open only the first incomplete section, to avoid a wall of open
  // rows. Browse/unit sections (no honest count) never auto-open.
  const firstOpenKey = groups
    .flatMap((g) => g.sections)
    .find((s) => isIncomplete(s))?.key;

  const placedCodes = new Set(audit.placement.keys());

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
            <span className="u-small">{headlineLabel}</span>
          </div>
          <div className="mp-bar mt-2">
            <span style={{ width: `${headlinePct}%` }} />
          </div>
          {headerCaption ? (
            <div className="av-note">{headerCaption}</div>
          ) : null}
        </div>
        <div className="pw-audit-list lg:flex-1 lg:min-h-0 [scrollbar-width:thin]">
          {groups.map((group) => (
            <div key={group.heading ?? "main"}>
              {group.heading ? (
                <div className="av-grouphead">{group.heading}</div>
              ) : null}
              {group.sections.map((section) => (
                <SectionRow
                  key={section.key}
                  section={section}
                  open={section.key === firstOpenKey}
                  placedCodes={placedCodes}
                  catalog={catalog}
                  catalogByCode={catalogByCode}
                  onDrill={onDrillToRequirement}
                  drag={drag}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
});

function isIncomplete(section: Section): boolean {
  if (section.kind === "node")
    return section.summary.satisfied < section.summary.needed;
  if (section.kind === "electiveFinite") return section.placed < section.need;
  return false;
}

/* ------------------------------- sections ------------------------------- */

function SectionRow({
  section,
  open,
  placedCodes,
  catalog,
  catalogByCode,
  onDrill,
  drag,
}: {
  section: Section;
  open: boolean;
  placedCodes: ReadonlySet<string>;
  catalog?: Course[];
  catalogByCode: Map<string, Course>;
  onDrill?: (codes: string[]) => void;
  drag?: DragWiring;
}) {
  if (section.kind === "unitBucket") {
    const pct =
      section.requiredUnits > 0
        ? Math.min(
            Math.round((section.appliedUnits / section.requiredUnits) * 100),
            100,
          )
        : 100;
    return (
      <div className="av-row">
        <div className="av-row-head">
          {section.unscoped ? (
            // No verifiable scope, so a progress ring would be a permanent,
            // misleading "0%". Show a manual-verification marker instead.
            <span
              className="av-unit-ring shrink-0"
              title="We can't verify this requirement's scope automatically — check it by hand."
            >
              <Icon name="shield" size="sm" aria-hidden="true" />
            </span>
          ) : (
            <span className="av-ring-wrap">
              <Ring pct={pct} />
              <span className="av-ring-num">
                {section.appliedUnits.toFixed(1)}
              </span>
            </span>
          )}
          <span className="flex flex-col gap-0.5 flex-1 min-w-0 text-left">
            <span className="av-sec-label truncate">{section.title}</span>
            <span className="u-small">{section.caption}</span>
          </span>
        </div>
      </div>
    );
  }

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
    // A unit-stated subject pool ("5.25 units of Science courses") tracks exact
    // units, not the approximate course count `selectCount`. Weight the placed
    // satisfiers by their catalog units. Falls through to the count display when
    // no catalog is available (read-only views).
    const rn = section.node.ruleNode;
    if (
      rn.kind === "subjectPool" &&
      rn.units != null &&
      catalogByCode.size > 0
    ) {
      const need = rn.units;
      const applied =
        Math.round(
          section.node.satisfiers.reduce(
            (s, p) => s + (catalogByCode.get(p.code)?.units ?? 0),
            0,
          ) * 100,
        ) / 100;
      const capped = Math.min(applied, need);
      const pct = Math.min(Math.round((applied / need) * 100), 100);
      return (
        <SectionShell
          title={section.title}
          caption={`${capped.toFixed(1)} of ${need} units`}
          ring={{ pct, num: capped }}
          excludedViolationCount={section.summary.excludedViolationCount}
          open={open}
        >
          <NodeBody
            node={section.node}
            placedCodes={placedCodes}
            catalog={catalog}
            catalogByCode={catalogByCode}
            onDrill={onDrill}
            drag={drag}
          />
        </SectionShell>
      );
    }
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
        // An optional group reaches a green 100% after a single pick, so tag it
        // "(optional)" — a satisfied optional group isn't a completed required one.
        title={optional ? `${section.title} (optional)` : section.title}
        caption={section.caption}
        ring={{ pct, num: chosen }}
        excludedViolationCount={section.summary.excludedViolationCount}
        open={open}
      >
        <NodeBody
          node={section.node}
          placedCodes={placedCodes}
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
  open,
  children,
}: {
  title: string;
  caption: string;
  /** Present → progress ring; absent → neutral doc glyph (unit/browse rows). */
  ring?: { pct: number; num: number };
  excludedViolationCount?: number;
  open: boolean;
  children: ReactNode;
}) {
  return (
    <details className="av-row group" open={open}>
      <summary className="av-row-head list-none select-none [&::-webkit-details-marker]:hidden">
        {ring ? (
          <span className="av-ring-wrap">
            <Ring pct={ring.pct} />
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
        {excludedViolationCount > 0 ? (
          <span
            className="inline-flex items-center gap-0.5 rounded-full bg-danger-soft text-danger px-1.5 py-0.5 text-[10px] font-medium tabular-nums shrink-0"
            title={`${excludedViolationCount} placed course${excludedViolationCount === 1 ? "" : "s"} cannot count toward this section`}
          >
            <Icon name="warning" size="xs" aria-hidden="true" />
            {excludedViolationCount}
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
  catalog,
  catalogByCode,
  onDrill,
  drag,
  depth = 0,
}: {
  node: AuditNode;
  placedCodes: ReadonlySet<string>;
  catalog?: Course[];
  catalogByCode: Map<string, Course>;
  onDrill?: (codes: string[]) => void;
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
    // Genuinely compound pick (an option requires several courses, an open
    // pool, etc.): render the alternatives under a concise "Choose N …" framing,
    // indented so they read as alternatives, not independent requirements. A
    // top-level one (rare) already has the framing as its section title.
    const children = node.children.map((child, i) => (
      <NodeBody
        // biome-ignore lint/suspicious/noArrayIndexKey: rule tree is stable
        key={i}
        node={child}
        placedCodes={placedCodes}
        catalog={catalog}
        catalogByCode={catalogByCode}
        onDrill={onDrill}
        drag={drag}
        depth={depth + 1}
      />
    ));
    if (depth === 0)
      return <div className="flex flex-col gap-1.5">{children}</div>;
    return (
      <div className="flex flex-col gap-1.5">
        <span className="u-small font-medium text-ink-2">{pickFraming(r)}</span>
        <div className="flex flex-col gap-1.5 pl-3 border-l border-line">
          {children}
        </div>
      </div>
    );
  }

  if (r.kind === "subjectPool") {
    return <SubjectPoolBody node={r} catalog={catalog} onDrill={onDrill} />;
  }

  if (r.kind === "all") {
    // A nested sub-group shows its own framing heading; the top-level group's
    // framing is already the section title. Children render their own headings,
    // so the parent never adds one (which would double up on mixed picks).
    return (
      <div className="flex flex-col gap-1.5">
        {depth > 0 && node.description ? (
          <span className="u-small mt-1">{node.description}</span>
        ) : null}
        {node.children.map((child, i) => (
          <NodeBody
            // biome-ignore lint/suspicious/noArrayIndexKey: rule tree is stable
            key={i}
            node={child}
            placedCodes={placedCodes}
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

/**
 * A required course. Placed → met-styled row with a check. Unplaced and
 * interactive → draggable row with a grip + "Add". Read-only → inert row.
 */
function CourseRow({
  code,
  placed,
  catalogByCode,
  onDrill,
  drag,
}: {
  code: string;
  placed: boolean;
  catalogByCode: Map<string, Course>;
  onDrill?: (codes: string[]) => void;
  drag?: DragWiring;
}) {
  const label = formatCourseCode(code);
  const title = catalogByCode.get(code)?.name ?? "";

  if (placed) {
    return (
      <div className="av-item met">
        <span className="av-item-grip met">
          <Icon name="check" size="sm" aria-hidden="true" />
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
): string {
  const min = r.selectMin;
  const max = r.selectMax;
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
  onDrill?: (codes: string[]) => void;
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
  onDrill?: (codes: string[]) => void;
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

/** An open subject pool: subject tags + a hint + Browse (no drag rows). */
function SubjectPoolBody({
  node,
  catalog,
  onDrill,
}: {
  node: SubjectPoolNode;
  catalog?: Course[];
  onDrill?: (codes: string[]) => void;
}) {
  const eligible = useMemo(
    () => (catalog ? subjectPoolEligible(node, catalog) : []),
    [node, catalog],
  );
  return (
    <div className="av-pool">
      <div className="av-pool-subj">
        {node.subjectCodes.map((s) => (
          <span key={s} className="av-subj">
            {s}
          </span>
        ))}
      </div>
      <p className="av-hint">
        {node.units != null
          ? `Any ${node.units} units from these subjects`
          : `Any ${node.selectCount} from these subjects`}{" "}
        — there's no fixed list to drag, so pick from the catalog.
      </p>
      {onDrill && eligible.length > 0 ? (
        <button
          type="button"
          className="av-browse"
          onClick={() => onDrill(eligible)}
        >
          <Icon name="search" size="xs" aria-hidden="true" /> Browse eligible
          courses <Icon name="arrow" size="xs" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

/* ------------------------------ primitives ------------------------------ */

/** SVG donut progress ring. Geometry per the design handoff. */
function Ring({
  pct,
  size = 34,
  stroke = 3.5,
}: {
  pct: number;
  size?: number;
  stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(pct, 100) / 100);
  const color =
    pct >= 100 ? "var(--met)" : pct > 0 ? "var(--partial)" : "var(--missing)";
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
function deriveSections(
  audit: AuditRoot,
  program: Program | null,
): {
  groups: SectionGroup[];
  totals: { needed: number; satisfied: number };
  /** Degree-wide unit progress, when the program has a unit plan with a total. */
  unitTotals: { applied: number; required: number } | null;
  /** Count-less elective requirements (open/unit lists) that the % can't cover. */
  untrackedCount: number;
  headerCaption: string | null;
} {
  const groups: SectionGroup[] = [];
  let totalNeeded = 0;
  let totalSatisfied = 0;
  let untrackedCount = 0;
  const addToTotals = (needed: number, satisfied: number) => {
    totalNeeded += needed;
    totalSatisfied += satisfied;
  };

  const placedCodes = new Set(audit.placement.keys());

  // Program requirements -------------------------------------------------
  if (audit.byTerm) {
    const termSections: Section[] = [];
    for (const t of TERM_LETTERS) {
      const node = audit.byTerm[t];
      if (!node) continue;
      const summary = summarize(node);
      if (summary.needed === 0) continue;
      addToTotals(summary.needed, summary.satisfied);
      termSections.push({
        kind: "node",
        key: `term-${t}`,
        title: `Term ${t}`,
        caption: nodeCaption(node, summary),
        node,
        summary,
      });
    }
    if (termSections.length > 0)
      groups.push({ heading: "Academic terms", sections: termSections });
  }

  if (audit.flexibleRoot) {
    const sections = explodeRoot(audit.flexibleRoot, "Program requirements");
    for (const s of sections)
      addToTotals(s.summary.needed, s.summary.satisfied);
    if (sections.length > 0) groups.push({ heading: null, sections });
  }

  // Electives ------------------------------------------------------------
  if (program) {
    const electiveSections = deriveElectiveSections(program).map((e, i) =>
      toElectiveSection(e, i, placedCodes),
    );
    for (const s of electiveSections) {
      if (s.kind === "electiveFinite")
        addToTotals(s.need, Math.min(s.placed, s.need));
      // Browse electives (open reference lists / unit-based) carry no honest
      // count, so they stay out of the % and are flagged as still-to-plan.
      else untrackedCount += 1;
    }
    if (electiveSections.length > 0)
      groups.push({ heading: "Electives", sections: electiveSections });
  }

  // Specialization -------------------------------------------------------
  if (audit.specializationRoot) {
    const sections = explodeRoot(audit.specializationRoot, "Specialization");
    for (const s of sections)
      addToTotals(s.summary.needed, s.summary.satisfied);
    if (sections.length > 0)
      groups.push({ heading: "Specialization", sections });
  }

  // Degree units (full unit accounting) ----------------------------------
  // A program is unit-based whenever it has a compiled unit audit. The headline
  // denominator is the stated degree total, or — when UW doesn't state one
  // (joint-honours half-plans) — the sum of the stated bucket requirements. No
  // total is fabricated; a course-count program has no unit audit at all.
  const ua = audit.unitAudit;
  const unitTotals = (() => {
    if (!ua) return null;
    const stated =
      ua.totalRequired ??
      Math.round(
        ua.buckets.reduce((s, b) => s + b.bucket.requiredUnits, 0) * 100,
      ) / 100;
    // Headline = "% of verifiable units". Units we can't verify (`unscoped`
    // buckets whose scope the rule tree couldn't recover) are excluded from BOTH
    // the numerator and denominator and flagged in the header caption — so the
    // % reflects only what's actually checkable, neither over- nor understating.
    const required = Math.round((stated - ua.unscopedUnits) * 100) / 100;
    // With *specific* (non-open) buckets, the numerator is allocated units, not
    // raw placed units: a course that landed in no bucket (overflow once every
    // eligible bucket is full) doesn't count, keeping the % consistent with the
    // per-bucket rings. When the plan has no specific buckets — a bare-total
    // program (engineering), or one whose only bucket is a small "open electives"
    // one while the real degree lives in the rule tree (double degrees) — there's
    // nothing meaningful to allocate into, so every placed unit counts toward the
    // total (else a complete plan would cap at the tiny open bucket's size).
    const hasSpecific = ua.buckets.some((b) => b.bucket.scope.kind !== "open");
    const applied = hasSpecific ? ua.allocatedUnits : ua.totalApplied;
    return required > 0 ? { applied, required } : null;
  })();
  // The bucket breakdown only renders when there are real buckets: an
  // engineering degree carries a unit total but no distribution buckets, so it
  // shows the unit headline alone.
  if (ua && (ua.buckets.length > 0 || ua.constraints.length > 0)) {
    const unitSections: Section[] = ua.buckets.map((b, i) => ({
      kind: "unitBucket",
      key: `unit-${b.bucket.id}-${i}`,
      title: b.title,
      // Unscoped buckets carry real units toward the total but can't be
      // auto-tracked (we won't guess their scope), so say so rather than
      // showing a misleading "0 of N".
      caption:
        b.bucket.scope.kind === "unscoped"
          ? `${b.bucket.requiredUnits} units · counts toward the total — verify manually`
          : `${b.appliedUnits.toFixed(1)} of ${b.bucket.requiredUnits} units`,
      appliedUnits: b.appliedUnits,
      requiredUnits: b.bucket.requiredUnits,
      status: b.status,
      unscoped: b.bucket.scope.kind === "unscoped",
    }));
    // Distribution constraints — overlapping checks over all placed courses:
    // faculty breadth ("1.0 unit of Humanities"), level minimums, "N units of
    // PLAN at 300+". The audit now honors each constraint's subject scope,
    // exclusions, and level, so the ✓ is trustworthy. (A residual "lecture/lab"
    // qualifier, which we can't verify, is the only soft edge.)
    ua.constraints.forEach((c, i) => {
      const min = c.constraint.minUnits;
      const caption =
        min != null
          ? `${c.satisfied ? "✓ " : ""}${c.appliedUnits.toFixed(1)} of ${min} units`
          : c.constraint.label;
      unitSections.push({
        kind: "info",
        key: `constraint-${i}`,
        title: c.constraint.label,
        caption,
      });
    });
    groups.push({ heading: "Degree units", sections: unitSections });
  }

  // Degree requirements (communication + informational) ------------------
  if (program) {
    const infoSections: Section[] = [];
    const deg = program.degreeRequirements;
    if (deg?.communication && deg.communication.options.length > 0) {
      const met = deg.communication.options.some((c) => placedCodes.has(c));
      infoSections.push({
        kind: "info",
        key: "deg-comm",
        title: "Communication requirement",
        caption: `${met ? "✓ " : ""}${deg.communication.options.map(formatCourseCode).join(" or ")}`,
      });
    }
    const items = [
      ...(program.informational ?? []),
      ...(deg?.informational ?? []),
    ];
    items.forEach((it, i) => {
      infoSections.push({
        kind: "info",
        key: `info-${i}`,
        title: it.label,
        caption: it.text,
      });
    });
    if (infoSections.length > 0)
      groups.push({ heading: "Degree requirements", sections: infoSections });
  }

  return {
    groups,
    totals: { needed: totalNeeded, satisfied: totalSatisfied },
    unitTotals,
    untrackedCount,
    headerCaption: buildHeaderCaption(
      program,
      untrackedCount,
      ua?.unscopedUnits ?? 0,
      unitTotals != null,
    ),
  };
}

function explodeRoot(root: AuditNode, fallbackTitle: string): NodeSection[] {
  // Two sibling groups can share a description (e.g. "Complete 2 courses from
  // the following choices"), so the key is index-based (unique) and repeated
  // titles get a trailing count for the reader.
  const seen = new Map<string, number>();
  const toSection = (
    node: AuditNode,
    baseTitle: string,
    idx: number,
  ): NodeSection => {
    const n = (seen.get(baseTitle) ?? 0) + 1;
    seen.set(baseTitle, n);
    const title = n > 1 ? `${baseTitle} (${n})` : baseTitle;
    const summary = summarize(node);
    return {
      kind: "node",
      key: `grp-${fallbackTitle}-${idx}`,
      title,
      caption: nodeCaption(node, summary),
      node,
      summary,
    };
  };
  if (root.ruleNode.kind === "all" && root.children.length > 0) {
    return root.children.map((child, i) =>
      toSection(child, child.description ?? `${fallbackTitle} ${i + 1}`, i),
    );
  }
  return [toSection(root, root.description ?? fallbackTitle, 0)];
}

function toElectiveSection(
  e: ElectiveSection,
  index: number,
  placedCodes: ReadonlySet<string>,
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

/** "{done} of {need} done · {hint}", where the hint counts required vs choice. */
function nodeCaption(node: AuditNode, summary: SectionSummary): string {
  let required = 0;
  let choices = 0;
  const walk = (n: AuditNode) => {
    const r = n.ruleNode;
    if (r.kind === "courses") required += r.courses.length;
    else if (r.kind === "pick" || r.kind === "subjectPool") choices += 1;
    else if (r.kind === "all") n.children.forEach(walk);
  };
  walk(node);
  const hintParts: string[] = [];
  if (required > 0) hintParts.push(`${required} required`);
  if (choices > 0)
    hintParts.push(`${choices} choice${choices === 1 ? "" : "s"}`);
  const hint = hintParts.join(" · ") || "complete";
  return summary.needed > 0
    ? `${summary.satisfied} of ${summary.needed} done · ${hint}`
    : hint;
}

function buildHeaderCaption(
  program: Program | null,
  untrackedCount: number,
  unscopedUnits: number,
  unitBased: boolean,
): string | null {
  if (!program) return null;
  // The honest, actionable lines: what the headline % can't measure. These are
  // real degree requirements, not optional extras.
  const parts: string[] = [];
  // Browse electives only sit *outside* the headline in a course-count program.
  // When the headline is units, a placed elective's units already count toward
  // it, so "not counted above" would be false — skip the line (the electives
  // still appear in their own section to plan from).
  if (!unitBased && untrackedCount > 0)
    parts.push(
      `+ ${untrackedCount} elective requirement${untrackedCount === 1 ? "" : "s"} to plan`,
    );
  // Unscoped buckets carry real units toward the total but we won't guess their
  // scope, so they're excluded from the headline — say how many to verify.
  if (unscopedUnits > 0)
    parts.push(`${unscopedUnits} units to verify manually`);
  if (parts.length > 0) return `${parts.join(" · ")} — not counted above.`;
  if (program.kind === "engineering")
    return `${TERM_LETTERS.length} academic terms`;
  return null;
}

/** Catalog codes matching a subject pool's prefixes + level bounds. */
function subjectPoolEligible(
  node: SubjectPoolNode,
  catalog: Course[],
): string[] {
  const subjects = new Set(node.subjectCodes.map((s) => s.toUpperCase()));
  const excluded = new Set((node.exclusions ?? []).map((c) => c.toLowerCase()));
  // Bucket the level the same way the compiler does (`levelBucket`), so the
  // Browse list offers exactly the courses the audit would credit. Comparing
  // the raw level against bucketed bounds (e.g. 486 vs maxLevel 400) wrongly
  // dropped upper-range courses the compiler still counts.
  return catalog
    .filter((c) => {
      const lvl = levelBucket(c.level);
      return (
        subjects.has(c.prefix.toUpperCase()) &&
        (node.minLevel == null || lvl >= node.minLevel) &&
        (node.maxLevel == null || lvl <= node.maxLevel) &&
        !excluded.has(c.code)
      );
    })
    .map((c) => c.code);
}
