"use client";

import { useMemo } from "react";
import {
  type AuditNode,
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

export function AuditPanel({ plan }: Props) {
  const program = plan.programId ? (PROGRAMS[plan.programId] ?? null) : null;

  const audit = useMemo(
    () => compileAudit(program, plan, plan.specializationId),
    [plan, program],
  );

  // Memoize every per-section summary in one pass so child renders never
  // re-walk the tree. `summary` is keyed on the same identity as `audit`, so
  // it only recomputes when the plan or program actually changes.
  const summaries = useMemo(() => {
    const byTerm: Partial<
      Record<(typeof TERM_LETTERS)[number], SectionSummary>
    > = {};
    let totalNeeded = 0;
    let totalSatisfied = 0;
    if (audit.byTerm) {
      for (const t of TERM_LETTERS) {
        const s = summarize(audit.byTerm[t]);
        byTerm[t] = s;
        totalNeeded += s.needed;
        totalSatisfied += s.satisfied;
      }
    }
    const flexibleRoot = audit.flexibleRoot
      ? summarize(audit.flexibleRoot)
      : null;
    if (flexibleRoot) {
      totalNeeded += flexibleRoot.needed;
      totalSatisfied += flexibleRoot.satisfied;
    }
    const specializationRoot = audit.specializationRoot
      ? summarize(audit.specializationRoot)
      : null;
    if (specializationRoot) {
      totalNeeded += specializationRoot.needed;
      totalSatisfied += specializationRoot.satisfied;
    }
    return {
      byTerm,
      flexibleRoot,
      specializationRoot,
      totalNeeded,
      totalSatisfied,
    };
  }, [audit]);

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
    <aside className="w-full lg:w-80 shrink-0 flex flex-col gap-3">
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-4 py-3 bg-zinc-50/60 dark:bg-zinc-900/40">
        <div className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Degree audit
        </div>
        <div className="text-2xl font-semibold tracking-tight">
          {summaries.totalSatisfied}
          <span className="text-zinc-400 dark:text-zinc-500">
            {" "}
            / {summaries.totalNeeded}
          </span>
        </div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          requirements placed
        </div>
      </div>

      {audit.byTerm
        ? TERM_LETTERS.map((t) => {
            const node = audit.byTerm?.[t];
            const summary = summaries.byTerm[t];
            if (!node || !summary) return null;
            return (
              <AuditSection key={t} title={t} node={node} summary={summary} />
            );
          })
        : null}

      {audit.flexibleRoot && summaries.flexibleRoot ? (
        <AuditSection
          title="Program requirements"
          node={audit.flexibleRoot}
          summary={summaries.flexibleRoot}
        />
      ) : null}

      {audit.specializationRoot && summaries.specializationRoot ? (
        <AuditSection
          title="Specialization"
          node={audit.specializationRoot}
          summary={summaries.specializationRoot}
        />
      ) : null}
    </aside>
  );
}

function AuditSection({
  title,
  node,
  summary,
}: {
  title: string;
  node: AuditNode;
  summary: SectionSummary;
}) {
  const { needed, satisfied, excludedViolationCount } = summary;
  return (
    <details
      className="rounded-lg border border-zinc-200 dark:border-zinc-800 group"
      open={node.status !== "met"}
    >
      <summary className="cursor-pointer flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900/50 select-none">
        <span className="flex items-center gap-2 min-w-0">
          <StatusDot status={node.status} />
          <span className="font-medium">{title}</span>
          {excludedViolationCount > 0 ? (
            <span
              className="rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 px-1.5 py-0.5 text-[10px] font-medium tabular-nums"
              title={`${excludedViolationCount} placed course${excludedViolationCount === 1 ? "" : "s"} cannot count toward this section`}
            >
              ⚠ {excludedViolationCount}
            </span>
          ) : null}
        </span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
          {satisfied}/{needed}
        </span>
      </summary>
      <div className="px-3 pb-3 pt-1">
        <AuditTree node={node} />
      </div>
    </details>
  );
}

function AuditTree({ node }: { node: AuditNode }) {
  // Branches with children → recurse. Leaves → render placed/missing chips.
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
            // The rule tree is structural; child position is meaningful.
            // biome-ignore lint/suspicious/noArrayIndexKey: rule tree is stable
            <li key={i} className="flex flex-col gap-1">
              <div className="flex items-center gap-2 text-xs">
                <StatusDot status={c.status} />
                <span className="flex-1 min-w-0 text-zinc-700 dark:text-zinc-300">
                  {c.description ?? fallbackLeafLabel(c)}
                </span>
              </div>
              <div className="pl-4">
                <AuditTree node={c} />
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return <LeafChips node={node} />;
}

function LeafChips({ node }: { node: AuditNode }) {
  const hasSatisfiers = node.satisfiers.length > 0;
  const hasMissing = node.missingCodes.length > 0;
  const hasExclusionViolations = (node.excludedViolations?.length ?? 0) > 0;

  if (!hasSatisfiers && !hasMissing && !hasExclusionViolations) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1.5 text-xs">
      {hasSatisfiers ? (
        <div className="flex flex-wrap gap-1">
          {node.satisfiers.map((s) => (
            <span
              key={s.code}
              title={`Placed in ${s.position}`}
              className="rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 px-1.5 py-0.5 font-mono"
            >
              {s.code}
            </span>
          ))}
        </div>
      ) : null}
      {hasMissing ? (
        <div className="flex flex-wrap gap-1">
          {node.missingCodes.map((c) => (
            <button
              key={c}
              type="button"
              disabled
              title="Add to plan (coming soon)"
              className="rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 px-1.5 py-0.5 font-mono opacity-70 cursor-not-allowed"
            >
              {c}
            </button>
          ))}
        </div>
      ) : null}
      {hasExclusionViolations ? (
        <div className="text-amber-700 dark:text-amber-300">
          ⚠ Cannot count toward plan:{" "}
          {node.excludedViolations?.map((v) => v.code).join(", ")}
        </div>
      ) : null}
    </div>
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
  // Decorative — status is communicated by adjacent label/count text.
  return (
    <span
      aria-hidden="true"
      className={`w-2 h-2 rounded-full shrink-0 ${color}`}
    />
  );
}
