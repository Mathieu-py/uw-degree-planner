"use client";

import { memo, useMemo } from "react";
import { Icon } from "@/components/ui/Icon";
import {
  type AuditNode,
  type AuditRoot,
  type AuditStatus,
  compileAudit,
  summarize,
} from "@/lib/audit/compile";
import { formatCourseCode } from "@/lib/format";
import type { LocalPlan } from "@/lib/plan/types";
import { PROGRAMS, TERM_LETTERS } from "@/lib/programs";

interface Props {
  plan: LocalPlan;
  /**
   * Clicking a missing-requirement chip opens the slot picker pre-filtered to
   * that requirement's courses (the design's "drill-in"). Optional — the
   * read-only shared view passes nothing, leaving chips inert.
   */
  onDrillToRequirement?: (codes: string[]) => void;
}

interface SectionSummary {
  needed: number;
  satisfied: number;
  excludedViolationCount: number;
}

interface Section {
  title: string;
  node: AuditNode;
  summary: SectionSummary;
}

// met / overSatisfied read as the green "met" dot; partial → amber; unmet →
// neutral "missing". Mirrors the design's sdot statuses.
function dotStatus(status: AuditStatus): "met" | "partial" | "missing" {
  if (status === "met" || status === "overSatisfied") return "met";
  if (status === "partial") return "partial";
  return "missing";
}

export const AuditPanel = memo(function AuditPanel({
  plan,
  onDrillToRequirement,
}: Props) {
  const program = plan.programId ? (PROGRAMS[plan.programId] ?? null) : null;

  const audit = useMemo(
    () => compileAudit(program, plan, plan.specializationId),
    [plan, program],
  );

  const { programSections, specializationSections, totals } = useMemo(
    () => deriveSections(audit),
    [audit],
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

  const pct =
    totals.needed > 0
      ? Math.min(Math.round((totals.satisfied / totals.needed) * 100), 100)
      : 0;

  return (
    <aside className="w-full lg:w-80 shrink-0 lg:h-full lg:flex lg:flex-col">
      <div className="card overflow-hidden lg:flex-1 lg:min-h-0 lg:flex lg:flex-col">
        <div className="pw-audit-top">
          <div className="flex items-baseline justify-between gap-2">
            <span className="u-eyebrow">Degree audit</span>
            <span className="u-mono u-small">
              {totals.satisfied}/{totals.needed}
            </span>
          </div>
          <div className="flex items-baseline gap-1.5 mt-2">
            <span className="text-[30px] font-bold tracking-tight leading-none">
              {pct}%
            </span>
            <span className="u-small">requirements met</span>
          </div>
          <div className="mp-bar mt-2">
            <span style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="pw-audit-list lg:flex-1 lg:min-h-0 [scrollbar-width:thin]">
          {programSections.map((s, i) => (
            <AuditSection
              // biome-ignore lint/suspicious/noArrayIndexKey: stable order
              key={`p-${i}`}
              section={s}
              onDrill={onDrillToRequirement}
            />
          ))}
          {specializationSections.map((s, i) => (
            <AuditSection
              // biome-ignore lint/suspicious/noArrayIndexKey: stable order
              key={`s-${i}`}
              section={s}
              onDrill={onDrillToRequirement}
            />
          ))}
        </div>
      </div>
    </aside>
  );
});

function AuditSection({
  section,
  onDrill,
}: {
  section: Section;
  onDrill?: (codes: string[]) => void;
}) {
  const { title, node, summary } = section;
  const { needed, satisfied, excludedViolationCount } = summary;
  return (
    <details className="pw-aud-g group" open={node.status !== "met"}>
      <summary className="pw-aud-head list-none select-none [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2.5 min-w-0 flex-1">
          <span className={`sdot sdot-${dotStatus(node.status)}`} />
          <span className="text-[13.5px] font-semibold truncate">{title}</span>
          {excludedViolationCount > 0 ? (
            <span
              className="inline-flex items-center gap-0.5 rounded-full bg-partial-soft text-partial px-1.5 py-0.5 text-[10px] font-medium tabular-nums shrink-0"
              title={`${excludedViolationCount} placed course${excludedViolationCount === 1 ? "" : "s"} cannot count toward this section`}
            >
              <Icon name="warning" size="xs" aria-hidden="true" />
              {excludedViolationCount}
            </span>
          ) : null}
        </span>
        <span className="flex items-center gap-2 shrink-0">
          <span
            className="u-mono u-small"
            style={{ color: node.status === "met" ? "var(--met)" : undefined }}
          >
            {satisfied}/{needed}
          </span>
          <span className="text-ink-3 inline-flex transition-transform group-open:rotate-90">
            <Icon name="chevronRight" size="xs" aria-hidden="true" />
          </span>
        </span>
      </summary>
      <div className="pw-aud-body">
        <AuditTree node={node} onDrill={onDrill} />
      </div>
    </details>
  );
}

function AuditTree({
  node,
  onDrill,
}: {
  node: AuditNode;
  onDrill?: (codes: string[]) => void;
}) {
  if (node.children.length > 0) {
    return (
      <div className="flex flex-col gap-3">
        {node.description ? (
          <span className="u-small">{node.description}</span>
        ) : null}
        <ul className="flex flex-col gap-3 pl-3 border-l border-line">
          {node.children.map((c, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rule tree is stable
            <li key={i} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 text-xs">
                <span className={`sdot sdot-${dotStatus(c.status)}`} />
                <span className="flex-1 min-w-0 text-ink-2">
                  {c.description ?? fallbackLeafLabel(c)}
                </span>
              </div>
              <div className="pl-4">
                <AuditTree node={c} onDrill={onDrill} />
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return <LeafChips node={node} onDrill={onDrill} />;
}

// Max chips to render before collapsing into a "+N more" overflow pill.
const CHIP_LIMIT = 8;

function LeafChips({
  node,
  onDrill,
}: {
  node: AuditNode;
  onDrill?: (codes: string[]) => void;
}) {
  const showSatisfiers = node.satisfiers.length > 0;
  const showMissing = node.missingCodes.length > 0;
  const hasExclusionViolations = (node.excludedViolations?.length ?? 0) > 0;

  if (!showSatisfiers && !showMissing && !hasExclusionViolations) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {showSatisfiers
        ? node.satisfiers.slice(0, CHIP_LIMIT).map((s) => (
            <span
              key={s.code}
              className="pw-areq is-met"
              title={`Placed in ${s.position}`}
            >
              <Icon name="check" size="xs" aria-hidden="true" />
              {formatCourseCode(s.code)}
            </span>
          ))
        : null}
      {node.satisfiers.length > CHIP_LIMIT ? (
        <OverflowChip count={node.satisfiers.length - CHIP_LIMIT} />
      ) : null}
      {showMissing
        ? node.missingCodes.slice(0, CHIP_LIMIT).map((c) => (
            <button
              key={c}
              type="button"
              disabled={!onDrill}
              onClick={() => onDrill?.(node.missingCodes)}
              title={
                onDrill
                  ? "Find courses for this requirement"
                  : formatCourseCode(c)
              }
              className="pw-areq is-miss disabled:cursor-default"
            >
              {formatCourseCode(c)}
            </button>
          ))
        : null}
      {node.missingCodes.length > CHIP_LIMIT ? (
        <OverflowChip count={node.missingCodes.length - CHIP_LIMIT} />
      ) : null}
      {hasExclusionViolations ? (
        <div className="flex items-start gap-1 text-partial text-[11px] w-full mt-0.5">
          <Icon
            name="warning"
            size="xs"
            aria-hidden="true"
            className="mt-0.5 shrink-0"
          />
          <span>
            Cannot count toward plan:{" "}
            {node.excludedViolations?.map((v) => v.code).join(", ")}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function OverflowChip({ count }: { count: number }) {
  return (
    <span className="text-accent px-1 py-0.5 text-[11px] font-medium">
      +{count} more
    </span>
  );
}

function fallbackLeafLabel(node: AuditNode): string {
  const r = node.ruleNode;
  if (r.kind === "courses") {
    return `${r.courses.length} course${r.courses.length === 1 ? "" : "s"} required`;
  }
  if (r.kind === "excluded") {
    return "Excluded courses";
  }
  return r.kind;
}

/**
 * Translate the raw AuditRoot into the category-based section list the panel
 * renders. Engineering programs (`byTerm`) get a synthetic "Core Courses"
 * section that aggregates every locked term's requirements into one flat
 * chip list. Flexible programs (`flexibleRoot`) expose their named requirement
 * categories directly; `specializationRoot` is treated the same under its own
 * group.
 */
function deriveSections(audit: AuditRoot): {
  programSections: Section[];
  specializationSections: Section[];
  totals: { needed: number; satisfied: number };
} {
  const programSections: Section[] = [];
  let totalNeeded = 0;
  let totalSatisfied = 0;

  if (audit.byTerm) {
    const termNodes = TERM_LETTERS.map((t) => audit.byTerm?.[t]).filter(
      (n): n is AuditNode => n != null,
    );
    if (termNodes.length > 0) {
      const coreSection = synthesizeCoreSection(termNodes);
      programSections.push(coreSection);
      totalNeeded += coreSection.summary.needed;
      totalSatisfied += coreSection.summary.satisfied;
    }
  }

  if (audit.flexibleRoot) {
    for (const s of explodeRoot(audit.flexibleRoot, "Program requirements")) {
      programSections.push(s);
      totalNeeded += s.summary.needed;
      totalSatisfied += s.summary.satisfied;
    }
  }

  const specializationSections: Section[] = [];
  if (audit.specializationRoot) {
    for (const s of explodeRoot(audit.specializationRoot, "Specialization")) {
      specializationSections.push(s);
      totalNeeded += s.summary.needed;
      totalSatisfied += s.summary.satisfied;
    }
  }

  return {
    programSections,
    specializationSections,
    totals: { needed: totalNeeded, satisfied: totalSatisfied },
  };
}

function explodeRoot(root: AuditNode, fallbackTitle: string): Section[] {
  if (root.ruleNode.kind === "all" && root.children.length > 0) {
    return root.children.map((child, i) => ({
      title: child.description ?? `${fallbackTitle} ${i + 1}`,
      node: child,
      summary: summarize(child),
    }));
  }
  return [
    {
      title: root.description ?? fallbackTitle,
      node: root,
      summary: summarize(root),
    },
  ];
}

/**
 * Flatten every byTerm tree's leaves into one synthetic "Core Courses"
 * section: all satisfiers and missing codes collapsed into a single chip list,
 * with summed needed/satisfied counts. The synthetic ruleNode/AuditNode
 * pretends to be a `courses` leaf so LeafChips handles it without any branch in
 * the tree walker.
 */
function synthesizeCoreSection(termNodes: AuditNode[]): Section {
  const satisfiers = termNodes.flatMap((n) => collectSatisfiers(n));
  const missingCodes = termNodes.flatMap((n) => collectMissing(n));
  let needed = 0;
  let satisfied = 0;
  let excludedViolationCount = 0;
  for (const n of termNodes) {
    const s = summarize(n);
    needed += s.needed;
    satisfied += s.satisfied;
    excludedViolationCount += s.excludedViolationCount;
  }

  const seenSat = new Set<string>();
  const dedupedSat: AuditNode["satisfiers"] = [];
  for (const p of satisfiers) {
    if (seenSat.has(p.code)) continue;
    seenSat.add(p.code);
    dedupedSat.push(p);
  }
  const seenMiss = new Set<string>();
  const dedupedMiss: string[] = [];
  for (const c of missingCodes) {
    if (seenMiss.has(c)) continue;
    seenMiss.add(c);
    dedupedMiss.push(c);
  }

  const allCodes = [...dedupedSat.map((p) => p.code), ...dedupedMiss];
  const syntheticNode: AuditNode = {
    ruleNode: { kind: "courses", courses: allCodes },
    status:
      needed === 0
        ? "met"
        : satisfied === needed
          ? "met"
          : satisfied > 0
            ? "partial"
            : "unmet",
    satisfiers: dedupedSat,
    missingCodes: dedupedMiss,
    children: [],
  };
  return {
    title: `Core Courses (${needed})`,
    node: syntheticNode,
    summary: { needed, satisfied, excludedViolationCount },
  };
}

function collectSatisfiers(node: AuditNode): AuditNode["satisfiers"] {
  if (node.children.length === 0) return node.satisfiers;
  return node.children.flatMap((c) => collectSatisfiers(c));
}

function collectMissing(node: AuditNode): string[] {
  if (node.children.length === 0) return node.missingCodes;
  return node.children.flatMap((c) => collectMissing(c));
}
