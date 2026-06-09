"use client";

import { memo, useMemo } from "react";
import type { Course } from "@/lib/courses/types";
import type { LocalPlan } from "@/lib/plan/types";
import type { ValidationIssue } from "@/lib/plan/validate";
import { AuditAdvisoryNotes } from "./AuditAdvisoryNotes";
import { AuditMacroList } from "./AuditMacroList";
import { buildProgramAudit } from "./buildProgramAudit";
import type { DragWiring, DrillFn } from "./types";

interface Props {
  plan: LocalPlan;
  /** The program this card audits. Resolved against PROGRAMS internally. */
  programId: string;
  catalog?: Course[];
  /** Shared `code → Course` lookup, built once by the parent. */
  catalogByCode: Map<string, Course>;
  /** Plan-wide validation issues; the credit-exclusion overlay is built per-program. */
  issues: readonly ValidationIssue[];
  /** Plan-wide count of prereq/antireq placement issues (header rollup). */
  blockingIssueCount: number;
  onDrillToRequirement?: DrillFn;
  drag?: DragWiring;
}

/**
 * One program's degree-audit card: the headline (units credited / % planned),
 * advisory notes, and the macro-section list. This is the **single-program**
 * panel — a plan with more than one program renders the master·detail layout in
 * `AuditPanel` instead, reusing the same `buildProgramAudit` + `AuditMacroList`.
 * The `legality` overlay and `catalogByCode` are plan-wide and passed in so they
 * aren't recomputed.
 */
export const ProgramAuditCard = memo(function ProgramAuditCard({
  plan,
  programId,
  catalog,
  catalogByCode,
  issues,
  blockingIssueCount,
  onDrillToRequirement,
  drag,
}: Props) {
  const data = useMemo(
    () => buildProgramAudit(plan, programId, catalogByCode, issues),
    [plan, programId, catalogByCode, issues],
  );

  const {
    program,
    macros,
    unverifiedCount,
    placedCodes,
    illegalCodes,
    headlinePct,
    estimatedDenom,
    headlineFraction,
  } = data;

  if (!program) {
    return (
      <div className="card px-4 py-6 text-sm text-partial">
        Unknown program: {programId}
      </div>
    );
  }

  return (
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
        <AuditAdvisoryNotes
          estimatedDenom={estimatedDenom}
          unverifiedCount={unverifiedCount}
          blockingIssueCount={blockingIssueCount}
        />
      </div>
      <AuditMacroList
        macros={macros}
        placedCodes={placedCodes}
        illegalCodes={illegalCodes}
        catalog={catalog}
        catalogByCode={catalogByCode}
        onDrill={onDrillToRequirement}
        drag={drag}
        className="pw-audit-list lg:flex-1 lg:min-h-0 [scrollbar-width:thin]"
      />
    </div>
  );
});
