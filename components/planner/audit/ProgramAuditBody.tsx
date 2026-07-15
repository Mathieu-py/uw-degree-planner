"use client";

import type { ProgramAuditData } from "@/lib/audit/view/buildProgramAudit";
import type { Course } from "@/lib/courses/types";
import { programCredential, programShortName } from "@/lib/programs";
import { AuditAdvisoryNotes } from "./AuditAdvisoryNotes";
import { AuditMacroList } from "./AuditMacroList";
import type { AcknowledgeFn, DragWiring, DrillFn } from "./types";
import { UnverifiedRequirements } from "./UnverifiedRequirements";

/**
 * Header chrome: "card" = single-program card (eyebrow, 30px headline);
 * "detail" = master·detail pane (tone/kicker/identity, 26px headline).
 */
type HeaderVariant =
  | { kind: "card" }
  | { kind: "detail"; tone: string; kicker: string };

interface Props {
  data: ProgramAuditData;
  /** For the acknowledge callback and the unknown-id name fallback; not in `data`. */
  programId: string;
  catalogByCode: Map<string, Course>;
  blockingIssueCount: number;
  /** Plan-level "add a partner" copy; only the single-program card shows it. */
  jointHonoursPartner?: string | null;
  onDrillToRequirement?: DrillFn;
  onAcknowledgeRequirement?: AcknowledgeFn;
  drag?: DragWiring;
  header: HeaderVariant;
}

/**
 * One program's audit body (headline, bar, advisories, unverified, macros) —
 * the single copy behind `ProgramAuditCard` and `AuditPanel`'s detail pane;
 * only header chrome and container classes differ, via `header`.
 */
export function ProgramAuditBody({
  data,
  programId,
  catalogByCode,
  blockingIssueCount,
  jointHonoursPartner,
  onDrillToRequirement,
  onAcknowledgeRequirement,
  drag,
  header,
}: Props) {
  const advisoryAndUnverified = (
    <>
      <AuditAdvisoryNotes
        estimatedDenom={data.estimatedDenom}
        blockingIssueCount={blockingIssueCount}
        jointHonoursPartner={jointHonoursPartner}
      />
      <UnverifiedRequirements
        programId={programId}
        items={data.unverifiedItems}
        staleCount={data.staleAcknowledgements.length}
        onAcknowledge={onAcknowledgeRequirement}
      />
    </>
  );
  const macroList = (className: string) => (
    <AuditMacroList
      macros={data.macros}
      placedCodes={data.placedCodes}
      illegalCodes={data.illegalCodes}
      catalogByCode={catalogByCode}
      onDrill={onDrillToRequirement}
      drag={drag}
      className={className}
    />
  );

  if (header.kind === "card") {
    return (
      <>
        <div className="pw-audit-top">
          <div className="flex items-baseline justify-between gap-2">
            <span className="u-eyebrow">Degree audit</span>
            <span className="u-mono u-small">{data.headlineFraction}</span>
          </div>
          <div className="flex items-baseline gap-1.5 mt-2">
            <span className="text-[30px] font-bold tracking-tight leading-none">
              {data.headlinePct}%
            </span>
            <span className="u-small">of degree planned</span>
          </div>
          <div className="mp-bar mt-2">
            <span style={{ width: `${data.headlinePct}%` }} />
          </div>
          {advisoryAndUnverified}
        </div>
        {macroList("pw-audit-list lg:flex-1 lg:min-h-0 [scrollbar-width:thin]")}
      </>
    );
  }

  return (
    <>
      <div className="mp-detail-head">
        <span className="mp-tone" style={{ background: header.tone }} />
        <div className="mp-detail-grow">
          <span className="mp-detail-kicker">{header.kicker}</span>
          <span className="mp-detail-name">
            {data.program ? programShortName(data.program) : programId}
          </span>
          <span className="u-small mp-detail-clip">
            {data.program ? programCredential(data.program) : ""}
          </span>
        </div>
        <div className="mp-detail-pct">
          <span className="text-[26px] font-bold tracking-tight leading-none">
            {data.headlinePct}%
          </span>
          <span className="u-small">{data.headlineFraction}</span>
        </div>
      </div>
      <div className="mp-bar" style={{ margin: "2px 0 4px" }}>
        <span style={{ width: `${data.headlinePct}%` }} />
      </div>
      {advisoryAndUnverified}
      {macroList("mp-detail-body [scrollbar-width:thin]")}
    </>
  );
}
