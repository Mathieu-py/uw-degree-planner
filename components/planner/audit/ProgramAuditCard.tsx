"use client";

import { memo, useMemo } from "react";
import type { Course } from "@/lib/courses/types";
import { jointHonoursWarning } from "@/lib/plan/jointHonours";
import type { LocalPlan } from "@/lib/plan/types";
import type { ValidationIssue } from "@/lib/plan/validate";
import { AuditAdvisoryNotes } from "./AuditAdvisoryNotes";
import { AuditMacroList } from "./AuditMacroList";
import { buildProgramAudit } from "./buildProgramAudit";
import type { AcknowledgeFn, DragWiring, DrillFn } from "./types";
import { UnverifiedRequirements } from "./UnverifiedRequirements";

interface Props {
  plan: LocalPlan;
  /** The program this card audits. Resolved against PROGRAMS internally. */
  programId: string;
  /** Shared `code → Course` lookup, built once by the parent. */
  catalogByCode: Map<string, Course>;
  /** Plan-wide validation issues; the credit-exclusion overlay is built per-program. */
  issues: readonly ValidationIssue[];
  /** Plan-wide count of prereq/antireq placement issues (header rollup). */
  blockingIssueCount: number;
  onDrillToRequirement?: DrillFn;
  /** Toggle manual confirmation of an unverified requirement. */
  onAcknowledgeRequirement?: AcknowledgeFn;
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
  catalogByCode,
  issues,
  blockingIssueCount,
  onDrillToRequirement,
  onAcknowledgeRequirement,
  drag,
}: Props) {
  const data = useMemo(
    () => buildProgramAudit(plan, programId, catalogByCode, issues),
    [plan, programId, catalogByCode, issues],
  );

  // A lone Joint Honours plan is only half a degree. Plan-level, so keyed
  // on the whole selection — never fires in the multi-program pane.
  const jointHonoursPartner = useMemo(
    () => jointHonoursWarning(plan.programIds),
    [plan.programIds],
  );

  const {
    program,
    macros,
    unverifiedItems,
    staleAcknowledgements,
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
          blockingIssueCount={blockingIssueCount}
          jointHonoursPartner={jointHonoursPartner}
        />
        <UnverifiedRequirements
          programId={programId}
          items={unverifiedItems}
          staleCount={staleAcknowledgements.length}
          onAcknowledge={onAcknowledgeRequirement}
        />
      </div>
      <AuditMacroList
        macros={macros}
        placedCodes={placedCodes}
        illegalCodes={illegalCodes}
        catalogByCode={catalogByCode}
        onDrill={onDrillToRequirement}
        drag={drag}
        className="pw-audit-list lg:flex-1 lg:min-h-0 [scrollbar-width:thin]"
      />
    </div>
  );
});
