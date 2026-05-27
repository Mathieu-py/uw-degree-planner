"use client";

import { useMemo } from "react";
import { AuditPanel } from "@/components/planner/audit/AuditPanel";
import {
  type ProgramOption,
  planSubtitle,
} from "@/components/planner/shell/PlannerShell";
import { Timeline } from "@/components/planner/timeline/Timeline";
import type { Course } from "@/lib/courses/types";
import type { ServerPlan } from "@/lib/plan/server/types";
import type { LocalPlan } from "@/lib/plan/types";
import { PLAN_SCHEMA_VERSION } from "@/lib/plan/types";
import { issuesBySlot, validatePlan } from "@/lib/plan/validate";

interface Props {
  plan: ServerPlan;
  catalog: Course[];
  programOptions: ProgramOption[];
}

/**
 * Public read-only view of a shared plan. Mounted from `/p/[shareToken]`.
 *
 * Distinct from PlannerShell: no auth/sync hooks, no mutation handlers, no
 * sidebar, no modals. Reuses the display primitives (Timeline + AuditPanel)
 * by adapting the loaded ServerPlan into a LocalPlan-shaped value, since
 * both downstream components already accept LocalPlan.
 */
export function SharedPlanView({ plan, catalog, programOptions }: Props) {
  // Adapter: ServerPlan → LocalPlan. The display tree expects LocalPlan;
  // schemaVersion + stream defaulting are the only fields that differ in
  // shape (server stream can be null; LocalPlan's enum doesn't include null).
  const localPlan = useMemo<LocalPlan>(
    () => ({
      schemaVersion: PLAN_SCHEMA_VERSION,
      programId: plan.programId,
      specializationId: plan.specializationId,
      stream: plan.stream ?? "regular",
      startTermId: plan.startTermId,
      slots: plan.slots,
      updatedAt: plan.updatedAt,
    }),
    [plan],
  );

  const catalogByCode = useMemo(
    () => new Map(catalog.map((c) => [c.code, c])),
    [catalog],
  );

  const issues = useMemo(
    () => validatePlan(localPlan, catalogByCode),
    [localPlan, catalogByCode],
  );
  const issuesPerSlot = useMemo(() => issuesBySlot(issues), [issues]);

  const programName =
    programOptions.find((p) => p.id === localPlan.programId)?.name ?? "—";

  return (
    <div className="flex flex-col gap-3">
      <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-zinc-950/90 backdrop-blur px-4 py-2.5">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="font-medium truncate max-w-[14rem]"
            title={plan.name}
          >
            {plan.name}
          </span>
          <span className="rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 px-2 py-0.5 text-[10px] uppercase tracking-wider">
            Shared · read-only
          </span>
        </div>
        <div className="flex-1 min-w-0 text-center truncate text-sm text-zinc-600 dark:text-zinc-300">
          {programName} · {planSubtitle(localPlan)}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-5">
        <div className="flex-1 min-w-0 flex flex-col gap-5">
          <Timeline
            plan={localPlan}
            issuesPerSlot={issuesPerSlot}
            onSlotClick={noop}
            onRemoveCourse={noop}
            readOnly
          />
        </div>
        <AuditPanel plan={localPlan} />
      </div>
    </div>
  );
}

function noop(): void {}
