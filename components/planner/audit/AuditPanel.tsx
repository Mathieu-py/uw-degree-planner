"use client";

import { memo, useMemo, useState } from "react";
import { Ring } from "@/components/ui/Ring";
import { countPlacementIssues } from "@/lib/audit/compile";
import type { Course } from "@/lib/courses/types";
import { jointHonoursWarning } from "@/lib/plan/jointHonours";
import type { LocalPlan } from "@/lib/plan/types";
import type { ValidationIssue } from "@/lib/plan/validate";
import { programShortCode } from "@/lib/programs";
import { programDetail } from "@/lib/programs/detail";
import { useProgramsDetail } from "@/lib/programs/usePlanPrograms";
import type { ProgramAuditData } from "./buildProgramAudit";
import { buildProgramAudit } from "./buildProgramAudit";
import { ProgramAuditBody } from "./ProgramAuditBody";
import { ProgramAuditCard } from "./ProgramAuditCard";
import type { AcknowledgeFn, DragWiring, DrillFn } from "./types";

interface Props {
  plan: LocalPlan;
  /** Shared `code → Course` lookup from usePlanValidation. */
  catalogByCode: Map<string, Course>;
  /**
   * Plan-wide issues from usePlanValidation (the panel doesn't validate).
   * Drives the per-program credit-exclusion overlay and the blocking note.
   */
  issues: readonly ValidationIssue[];
  /**
   * One code → term picker; multiple (open pool / elective) → slot picker
   * pre-filtered to those codes. Omitted by the read-only view (rows inert).
   */
  onDrillToRequirement?: DrillFn;
  /** Toggle manual confirmation of an unverified requirement; omitted read-only. */
  onAcknowledgeRequirement?: AcknowledgeFn;
  /** Drag lifecycle for course rows; omitted alongside the read-only view. */
  drag?: DragWiring;
}

/**
 * Program identity tones, assigned by index (primary degree first). A minor —
 * not yet modelled — would use `var(--ink-3)`.
 */
const PROGRAM_TONES = [
  "var(--accent-bg)",
  "var(--met)",
  "#5b6bb5",
  "#b5795b",
] as const;

export const AuditPanel = memo(function AuditPanel({
  plan,
  catalogByCode,
  issues,
  onDrillToRequirement,
  onAcknowledgeRequirement,
  drag,
}: Props) {
  // One per prereq-misplaced course + one per antireq conflict SET.
  const blockingIssueCount = useMemo(
    () => countPlacementIssues(issues),
    [issues],
  );

  // Plan-level lone-Joint-Honours warning; shown only in the single layout.
  const jointHonoursPartner = useMemo(
    () => jointHonoursWarning(plan.programIds),
    [plan.programIds],
  );

  const isMulti = plan.programIds.length > 1;
  // Detail (rule trees) for the plan's programs is fetched on demand; the
  // audit rebuilds once it lands.
  const detailLoaded = useProgramsDetail(plan.programIds);

  // Every program's audit (the multi rail needs all `pct`s; single is N=1),
  // gated on detail so fetch-window audits aren't built and discarded.
  const programData = useMemo(() => {
    if (!detailLoaded) return null;
    const map = new Map<string, ProgramAuditData>();
    for (const id of plan.programIds)
      map.set(
        id,
        buildProgramAudit(
          plan,
          id,
          programDetail.get(id),
          catalogByCode,
          issues,
        ),
      );
    return map;
  }, [plan, catalogByCode, issues, detailLoaded]);

  const [selectedId, setSelectedId] = useState(plan.programIds[0]);

  if (plan.programIds.length === 0) {
    return (
      <aside className="w-full lg:w-[28.75rem] shrink-0 card-2 border-dashed px-4 py-6 text-sm text-ink-3">
        Pick a program to see your degree audit.
      </aside>
    );
  }

  // Detail still loading → the one placeholder for both layouts.
  if (!programData) {
    return (
      <aside className="w-full lg:w-[28.75rem] shrink-0 card-2 px-4 py-6 text-sm text-ink-3">
        Loading degree audit…
      </aside>
    );
  }

  // Single program → the plain full-width card, exactly as before. Nothing to
  // switch between, so no rail and no plan-level rollup header.
  if (!isMulti) {
    const data = programData.get(plan.programIds[0]);
    // Always present (built above); narrows without a non-null assertion.
    if (!data) return null;
    return (
      <aside className="w-full lg:w-[28.75rem] shrink-0 lg:h-full lg:flex lg:flex-col">
        <ProgramAuditCard
          data={data}
          programId={plan.programIds[0]}
          catalogByCode={catalogByCode}
          blockingIssueCount={blockingIssueCount}
          jointHonoursPartner={jointHonoursPartner}
          onDrillToRequirement={onDrillToRequirement}
          onAcknowledgeRequirement={onAcknowledgeRequirement}
          drag={drag}
        />
      </aside>
    );
  }

  // Two+ programs → master·detail. The selection falls back to the primary if
  // the chosen program is no longer on the plan.
  const activeId = programData.has(selectedId)
    ? selectedId
    : plan.programIds[0];
  const detail = programData.get(activeId);
  const activeIdx = plan.programIds.indexOf(activeId);
  // activeId is always a key of programData (it falls back to programIds[0],
  // which is inserted above), so this guard is defensive — it narrows the type
  // without a non-null assertion.
  if (!detail) return null;

  return (
    <aside className="w-full lg:w-[28.75rem] shrink-0 lg:h-full">
      <div className="card pw-audit overflow-hidden lg:h-full lg:flex lg:flex-col">
        {/*
         * No combined %: hand-picked programs have no authoritative joint
         * denominator, so each is audited on its own (rail + detail) over the full
         * plan — credit follows the calendar's requirements, not term of
         * completion. Keeping the audits independent also honours the calendar's
         * double-counting cap ("a course can be used to satisfy requirements for a
         * maximum of two credentials"): no single course is summed into a shared
         * denominator across programs. UW's packaged double degrees (e.g.
         * `bba-and-bmath-double-degree`) are single programs picked directly.
         * Suggesting that swap is tracked.
         */}
        <div className="pw-audit-top">
          <div className="flex items-baseline justify-between gap-2">
            <span className="u-eyebrow">Plan audit</span>
            <span className="u-mono u-small">
              {plan.programIds.length} programs
            </span>
          </div>
          <div className="av-note mt-2">
            Each program is audited on its own — hand-picked programs
            aren&apos;t combined into a single score.
          </div>
        </div>

        <div className="mp-split lg:flex-1 lg:min-h-0">
          {/* Slim program rail (master). */}
          <div className="mp-rail">
            {[...programData].map(([id, d], idx) => {
              const active = id === activeId;
              return (
                <button
                  key={id}
                  type="button"
                  className={`mp-pip${active ? " is-active" : ""}`}
                  title={d.program?.name ?? id}
                  aria-pressed={active}
                  onClick={() => setSelectedId(id)}
                >
                  {active ? (
                    <span
                      className="mp-pip-mark"
                      style={{
                        background: PROGRAM_TONES[idx % PROGRAM_TONES.length],
                      }}
                    />
                  ) : null}
                  <span className="av-ring-wrap">
                    <Ring pct={d.progress.pct} size={38} />
                    <span className="av-ring-num" style={{ fontSize: "9.5px" }}>
                      {d.progress.pct}
                    </span>
                  </span>
                  <span className="mp-pip-abbr">
                    {d.program ? programShortCode(d.program) : "?"}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Detail pane (selected program's full audit). */}
          <div className="mp-detail">
            <ProgramAuditBody
              data={detail}
              programId={activeId}
              catalogByCode={catalogByCode}
              blockingIssueCount={blockingIssueCount}
              onDrillToRequirement={onDrillToRequirement}
              onAcknowledgeRequirement={onAcknowledgeRequirement}
              drag={drag}
              header={{
                kind: "detail",
                tone: PROGRAM_TONES[activeIdx % PROGRAM_TONES.length],
                kicker: activeIdx === 0 ? "Primary degree" : "Degree",
              }}
            />
          </div>
        </div>
      </div>
    </aside>
  );
});
