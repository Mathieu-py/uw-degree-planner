"use client";

import { memo, useMemo } from "react";
import { computeAverages } from "@/lib/audit/averages";
import {
  compileAudit,
  legalityKeySet,
  placementLegalityKey,
} from "@/lib/audit/compile";
import { computeDegreeProgress } from "@/lib/audit/progress";
import type { Course } from "@/lib/courses/types";
import { fmtUnits } from "@/lib/format";
import type { LocalPlan } from "@/lib/plan/types";
import { validatePlan } from "@/lib/plan/validate";
import { PROGRAMS } from "@/lib/programs";
import { deriveMacros } from "./deriveMacros";
import { AveragesRow } from "./sections/AveragesRow";
import { MacroSection } from "./sections/MacroSection";
import type { DragWiring, DrillFn } from "./types";

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
