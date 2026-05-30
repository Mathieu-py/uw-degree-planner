"use client";

import { memo, useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import {
  type AuditNode,
  type AuditRoot,
  type AuditStatus,
  compileAudit,
  summarize,
} from "@/lib/audit/compile";
import type { LocalPlan } from "@/lib/plan/types";
import { PROGRAMS, TERM_LETTERS } from "@/lib/programs";

interface Props {
  plan: LocalPlan;
}

interface SectionSummary {
  needed: number;
  satisfied: number;
  excludedViolationCount: number;
}

type FilterMode = "missing" | "placed" | "all";

interface Section {
  title: string;
  node: AuditNode;
  summary: SectionSummary;
}

export const AuditPanel = memo(function AuditPanel({ plan }: Props) {
  const program = plan.programId ? (PROGRAMS[plan.programId] ?? null) : null;
  const [filter, setFilter] = useState<FilterMode>("missing");

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
      <aside className="w-full lg:w-80 shrink-0 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 px-4 py-6 text-sm text-zinc-500 dark:text-zinc-400">
        Pick a program to see degree audit.
      </aside>
    );
  }
  if (!program) {
    return (
      <aside className="w-full lg:w-80 shrink-0 rounded-lg border border-zinc-200 dark:border-zinc-800 px-4 py-6 text-sm text-amber-600 dark:text-amber-300">
        Unknown program: {plan.programId}
      </aside>
    );
  }

  return (
    <aside className="w-full lg:w-80 shrink-0 lg:h-full lg:flex lg:flex-col">
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/40 overflow-hidden lg:flex-1 lg:min-h-0 lg:flex lg:flex-col">
        <div className="px-4 py-4">
          <div className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Degree audit
          </div>
          <div className="text-2xl font-semibold tracking-tight mt-1">
            {totals.satisfied}
            <span className="text-zinc-400 dark:text-zinc-500">
              {" "}
              / {totals.needed}
            </span>
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            requirements placed
          </div>
        </div>

        <div className="border-t border-zinc-200 dark:border-zinc-800">
          <FilterTabs value={filter} onChange={setFilter} />
        </div>

        <div className="border-t border-zinc-200 dark:border-zinc-800 px-3 py-2 flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800 lg:flex-1 lg:min-h-0 lg:overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {programSections.map((s, i) => (
            <AuditSection
              // biome-ignore lint/suspicious/noArrayIndexKey: stable order
              key={`p-${i}`}
              title={s.title}
              node={s.node}
              summary={s.summary}
              filter={filter}
            />
          ))}
          {specializationSections.map((s, i) => (
            <AuditSection
              // biome-ignore lint/suspicious/noArrayIndexKey: stable order
              key={`s-${i}`}
              title={s.title}
              node={s.node}
              summary={s.summary}
              filter={filter}
            />
          ))}
        </div>
      </div>
    </aside>
  );
});

const FILTER_LABEL: Record<FilterMode, string> = {
  missing: "Missing",
  placed: "Placed",
  all: "All",
};

function FilterTabs({
  value,
  onChange,
}: {
  value: FilterMode;
  onChange: (next: FilterMode) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Audit filter"
      className="flex items-stretch"
    >
      {(Object.keys(FILTER_LABEL) as FilterMode[]).map((m) => {
        const active = m === value;
        return (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(m)}
            className={
              "flex-1 text-center py-2.5 text-xs transition-colors border-b-2 " +
              (active
                ? "font-medium text-zinc-900 dark:text-zinc-100 border-violet-500"
                : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 border-transparent")
            }
          >
            {FILTER_LABEL[m]}
          </button>
        );
      })}
    </div>
  );
}

function AuditSection({
  title,
  node,
  summary,
  filter,
}: {
  title: string;
  node: AuditNode;
  summary: SectionSummary;
  filter: FilterMode;
}) {
  const { needed, satisfied, excludedViolationCount } = summary;
  return (
    <details className="group py-2" open={node.status !== "met"}>
      <summary className="cursor-pointer flex items-center justify-between gap-2 px-1 py-1 text-sm rounded hover:bg-zinc-100/60 dark:hover:bg-zinc-800/40 select-none list-none [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2 min-w-0">
          <span
            aria-hidden="true"
            className="text-zinc-400 dark:text-zinc-500 text-base leading-none transition-transform group-open:rotate-90 shrink-0 w-3 text-center"
          >
            ›
          </span>
          <span className="truncate font-medium">{title}</span>
          {excludedViolationCount > 0 ? (
            <span
              className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 px-1.5 py-0.5 text-[10px] font-medium tabular-nums"
              title={`${excludedViolationCount} placed course${excludedViolationCount === 1 ? "" : "s"} cannot count toward this section`}
            >
              <Icon name="warning" size="xs" aria-hidden="true" />
              {excludedViolationCount}
            </span>
          ) : null}
        </span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums shrink-0">
          {satisfied} / {needed}
        </span>
      </summary>
      <div className="pl-5 pr-1 pb-2 pt-1.5">
        <AuditTree node={node} filter={filter} />
      </div>
    </details>
  );
}

function AuditTree({ node, filter }: { node: AuditNode; filter: FilterMode }) {
  if (node.children.length > 0) {
    return (
      <div className="flex flex-col gap-2">
        {node.description ? (
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            {node.description}
          </div>
        ) : null}
        <ul className="flex flex-col gap-2 pl-3 border-l border-zinc-200 dark:border-zinc-800">
          {node.children.map((c, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rule tree is stable
            <li key={i} className="flex flex-col gap-1">
              <div className="flex items-center gap-2 text-xs">
                <StatusDot status={c.status} />
                <span className="flex-1 min-w-0 text-zinc-700 dark:text-zinc-300">
                  {c.description ?? fallbackLeafLabel(c)}
                </span>
              </div>
              <div className="pl-4">
                <AuditTree node={c} filter={filter} />
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return <LeafChips node={node} filter={filter} />;
}

// Max chips to render before collapsing into a "+N more" overflow pill.
const CHIP_LIMIT = 6;

function LeafChips({ node, filter }: { node: AuditNode; filter: FilterMode }) {
  const showSatisfiers = filter !== "missing" && node.satisfiers.length > 0;
  const showMissing = filter !== "placed" && node.missingCodes.length > 0;
  const hasExclusionViolations = (node.excludedViolations?.length ?? 0) > 0;

  if (!showSatisfiers && !showMissing && !hasExclusionViolations) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1.5 text-xs">
      {showSatisfiers ? (
        <ChipRow>
          {node.satisfiers.slice(0, CHIP_LIMIT).map((s) => (
            <span
              key={s.code}
              title={`Placed in ${s.position}`}
              className="rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 px-2 py-0.5 font-mono uppercase"
            >
              {s.code}
            </span>
          ))}
          {node.satisfiers.length > CHIP_LIMIT ? (
            <OverflowChip count={node.satisfiers.length - CHIP_LIMIT} />
          ) : null}
        </ChipRow>
      ) : null}
      {showMissing ? (
        <ChipRow>
          {node.missingCodes.slice(0, CHIP_LIMIT).map((c) => (
            <button
              key={c}
              type="button"
              disabled
              title="Add to plan (coming soon)"
              className="rounded-md bg-zinc-100 dark:bg-zinc-800/70 text-zinc-600 dark:text-zinc-300 px-2 py-0.5 font-mono uppercase opacity-90 cursor-not-allowed"
            >
              {c}
            </button>
          ))}
          {node.missingCodes.length > CHIP_LIMIT ? (
            <OverflowChip count={node.missingCodes.length - CHIP_LIMIT} />
          ) : null}
        </ChipRow>
      ) : null}
      {hasExclusionViolations ? (
        <div className="flex items-start gap-1 text-amber-700 dark:text-amber-300">
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

function ChipRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-1.5">{children}</div>;
}

function OverflowChip({ count }: { count: number }) {
  return (
    <span className="rounded-md text-violet-600 dark:text-violet-400 px-2 py-0.5 text-[11px] font-medium">
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

function StatusDot({ status }: { status: AuditStatus }) {
  const color =
    status === "met"
      ? "bg-emerald-500"
      : status === "partial"
        ? "bg-amber-500"
        : status === "overSatisfied"
          ? "bg-blue-500"
          : "bg-zinc-300 dark:bg-zinc-700";
  return (
    <span
      aria-hidden="true"
      className={`w-2 h-2 rounded-full shrink-0 ${color}`}
    />
  );
}

/**
 * Translate the raw AuditRoot into the category-based section list the panel
 * renders. Engineering programs (`byTerm`) get a synthetic "Core Courses"
 * section that aggregates every locked term's requirements into one flat
 * chip list — this matches the mockup where AFM 111/112/113… all live under
 * a single "Core Courses" category, not split per-term.
 *
 * Flexible programs (`flexibleRoot`) typically root in an `all` whose
 * children are the named requirement categories (e.g. "Communication
 * Requirement", "Electives"); expose those children directly as top-level
 * sections.
 *
 * `specializationRoot` is treated the same way under its own group.
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
 * section: all satisfiers and missing codes collapsed into a single chip
 * list, with summed needed/satisfied counts. The synthetic ruleNode/AuditNode
 * pretends to be a `courses` leaf so the existing LeafChips renderer handles
 * it without any branch in the tree walker.
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

  // Dedupe across terms — a course locked in two places (shouldn't happen,
  // but defensive) should only appear once in the chip list.
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
