"use client";

import { memo, useMemo } from "react";
import {
  compileAudit,
  legalityKeySet,
  placementLegalityKey,
} from "@/lib/audit/compile";
import { computeDegreeProgress } from "@/lib/audit/progress";
import type { Course } from "@/lib/courses/types";
import { countNoun, fmtUnits } from "@/lib/format";
import type { LocalPlan } from "@/lib/plan/types";
import { validatePlan } from "@/lib/plan/validate";
import { PROGRAMS } from "@/lib/programs";
import { deriveMacros } from "./deriveMacros";
import { MacroSection } from "./sections/MacroSection";
import type { DragWiring, DrillFn } from "./types";

interface Props {
  plan: LocalPlan;
  /**
   * Catalog for row titles and resolving a pool's eligible codes for Browse.
   * Absent in read-only contexts → rows show code-only, no pool Browse.
   */
  catalog?: Course[];
  /**
   * One code → term picker; multiple (open pool / elective) → slot picker
   * pre-filtered to those codes. Omitted by the read-only view (rows inert).
   */
  onDrillToRequirement?: DrillFn;
  /** Drag lifecycle for course rows; omitted alongside the read-only view. */
  drag?: DragWiring;
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

  // Legality overlay: a satisfier placed before its prereqs (or in antireq
  // conflict) still counts but is flagged. Needs the catalog for requisite
  // strings; empty without it. `blockingIssueCount` is the header rollup.
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
        legality,
      ),
    [
      audit,
      program,
      progress.freeUnits,
      progress.breadthRequirements,
      progress.levelFloors,
      unitsOf,
      legality,
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

  // One honest headline: how much of the whole degree the plan accounts for,
  // not a sum of overlapping slots. See computeDegreeProgress.
  const headlinePct = progress.pct;
  // No calendar total (e.g. Joint Honours, units split across plans) → fall back
  // to the sum of structured requirements. Mark it so it's not read as exact.
  const estimatedDenom = progress.totalUnits == null;
  const headlineFraction = `${fmtUnits(progress.creditedUnits)}/${estimatedDenom ? "~" : ""}${fmtUnits(progress.denom)} units`;

  const placedCodes = new Set(audit.placement.keys());
  // Illegally-placed codes: still in `placedCodes` (shown on their row) but
  // flagged and excluded from ring counts + headline.
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
              {countNoun(unverifiedCount, "requirement")} couldn't be
              auto-verified — check with your advisor.
            </div>
          ) : null}
          {blockingIssueCount > 0 ? (
            <div className="av-note text-partial">
              ⚠ {countNoun(blockingIssueCount, "placement issue")}{" "}
              (prereq/antireq) — those courses are excluded from the bar until
              fixed.
            </div>
          ) : null}
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
