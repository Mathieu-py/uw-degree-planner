"use client";

import { memo, useMemo, useState } from "react";
import { Ring } from "@/components/ui/Ring";
import { countPlacementIssues } from "@/lib/audit/compile";
import type { Course } from "@/lib/courses/types";
import type { LocalPlan } from "@/lib/plan/types";
import { validatePlan } from "@/lib/plan/validate";
import {
  programCredential,
  programShortCode,
  programShortName,
} from "@/lib/programs";
import { AuditAdvisoryNotes } from "./AuditAdvisoryNotes";
import { AuditMacroList } from "./AuditMacroList";
import type { ProgramAuditData } from "./buildProgramAudit";
import { buildProgramAudit } from "./buildProgramAudit";
import { ProgramAuditCard } from "./ProgramAuditCard";
import type { AcknowledgeFn, DragWiring, DrillFn } from "./types";
import { UnverifiedRequirements } from "./UnverifiedRequirements";

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
  catalog,
  onDrillToRequirement,
  onAcknowledgeRequirement,
  drag,
}: Props) {
  const catalogByCode = useMemo(
    () => new Map((catalog ?? []).map((c) => [c.code, c])),
    [catalog],
  );

  // Plan-wide validation issues drive the per-program credit-exclusion overlay
  // (built inside buildProgramAudit, since the antireq keeper is program-
  // specific) and the header count. Needs the catalog for requisite strings.
  // The count is one per prereq-misplaced course + one per antireq conflict SET.
  const { issues, blockingIssueCount } = useMemo(() => {
    if (catalogByCode.size === 0)
      return {
        issues: [] as ReturnType<typeof validatePlan>,
        blockingIssueCount: 0,
      };
    const found = validatePlan(plan, catalogByCode);
    return { issues: found, blockingIssueCount: countPlacementIssues(found) };
  }, [plan, catalogByCode]);

  const isMulti = plan.programIds.length > 1;

  // For a double degree, build every program's audit once (the rail needs all
  // their `pct`s, the detail needs the selected one's macros). Skipped for the
  // common single-program case, where the card computes its own audit.
  const programData = useMemo(() => {
    if (plan.programIds.length <= 1) return null;
    const map = new Map<string, ProgramAuditData>();
    for (const id of plan.programIds)
      map.set(id, buildProgramAudit(plan, id, catalogByCode, issues));
    return map;
  }, [plan, catalogByCode, issues]);

  const [selectedId, setSelectedId] = useState(plan.programIds[0]);

  if (plan.programIds.length === 0) {
    return (
      <aside className="w-full lg:w-[28.75rem] shrink-0 card-2 border-dashed px-4 py-6 text-sm text-ink-3">
        Pick a program to see your degree audit.
      </aside>
    );
  }

  // Single program → the plain full-width card, exactly as before. Nothing to
  // switch between, so no rail and no plan-level rollup header.
  if (!isMulti || !programData) {
    return (
      <aside className="w-full lg:w-[28.75rem] shrink-0 lg:h-full lg:flex lg:flex-col">
        <ProgramAuditCard
          plan={plan}
          programId={plan.programIds[0]}
          catalogByCode={catalogByCode}
          issues={issues}
          blockingIssueCount={blockingIssueCount}
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
         * Suggesting that swap is tracked in #103.
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
            <div className="mp-detail-head">
              <span
                className="mp-tone"
                style={{
                  background: PROGRAM_TONES[activeIdx % PROGRAM_TONES.length],
                }}
              />
              <div className="mp-detail-grow">
                <span className="mp-detail-kicker">
                  {activeIdx === 0 ? "Primary degree" : "Degree"}
                </span>
                <span className="mp-detail-name">
                  {detail.program ? programShortName(detail.program) : activeId}
                </span>
                <span className="u-small mp-detail-clip">
                  {detail.program ? programCredential(detail.program) : ""}
                </span>
              </div>
              <div className="mp-detail-pct">
                <span className="text-[26px] font-bold tracking-tight leading-none">
                  {detail.progress.pct}%
                </span>
                <span className="u-small">{detail.headlineFraction}</span>
              </div>
            </div>
            <div className="mp-bar" style={{ margin: "2px 0 4px" }}>
              <span style={{ width: `${detail.progress.pct}%` }} />
            </div>
            <AuditAdvisoryNotes
              estimatedDenom={detail.estimatedDenom}
              blockingIssueCount={blockingIssueCount}
            />
            <UnverifiedRequirements
              programId={activeId}
              items={detail.unverifiedItems}
              staleCount={detail.staleAcknowledgements.length}
              onAcknowledge={onAcknowledgeRequirement}
            />
            <AuditMacroList
              macros={detail.macros}
              placedCodes={detail.placedCodes}
              illegalCodes={detail.illegalCodes}
              catalogByCode={catalogByCode}
              onDrill={onDrillToRequirement}
              drag={drag}
              className="mp-detail-body [scrollbar-width:thin]"
            />
          </div>
        </div>
      </div>
    </aside>
  );
});
