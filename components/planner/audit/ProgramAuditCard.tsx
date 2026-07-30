"use client";

import { memo } from "react";
import type { ProgramAuditData } from "@/lib/audit/view/buildProgramAudit";
import type { Course } from "@/lib/courses/types";
import { ProgramAuditBody } from "./ProgramAuditBody";
import type { AcknowledgeFn, DragWiring, DrillFn } from "./types";

interface Props {
  /** Prebuilt audit for this program — AuditPanel owns all audit computation. */
  data: ProgramAuditData;
  programId: string;
  /** Shared `code → Course` lookup, built once by the parent. */
  catalogByCode: Map<string, Course>;
  /** Plan-wide count of prereq/antireq placement issues (header rollup). */
  blockingIssueCount: number;
  /** Lone-Joint-Honours notice; plan-level, so the caller computes it. */
  jointHonoursPartner: string | null;
  onDrillToRequirement?: DrillFn;
  /** Toggle manual confirmation of an unverified requirement. */
  onAcknowledgeRequirement?: AcknowledgeFn;
  drag?: DragWiring;
}

/**
 * The single-program audit card (multi-program plans get AuditPanel's
 * master·detail instead; both wrap `ProgramAuditBody`). Presentational —
 * the audit arrives prebuilt and loading is owned by `AuditPanel`.
 */
export const ProgramAuditCard = memo(function ProgramAuditCard({
  data,
  programId,
  catalogByCode,
  blockingIssueCount,
  jointHonoursPartner,
  onDrillToRequirement,
  onAcknowledgeRequirement,
  drag,
}: Props) {
  if (!data.program) {
    return (
      <div className="card px-4 py-6 text-sm text-partial">
        Unknown program: {programId}
      </div>
    );
  }

  return (
    <div className="card pw-audit-card overflow-hidden lg:flex-1 lg:min-h-0 lg:flex lg:flex-col">
      <ProgramAuditBody
        data={data}
        programId={programId}
        catalogByCode={catalogByCode}
        blockingIssueCount={blockingIssueCount}
        jointHonoursPartner={jointHonoursPartner}
        onDrillToRequirement={onDrillToRequirement}
        onAcknowledgeRequirement={onAcknowledgeRequirement}
        drag={drag}
        header={{ kind: "card" }}
      />
    </div>
  );
});
