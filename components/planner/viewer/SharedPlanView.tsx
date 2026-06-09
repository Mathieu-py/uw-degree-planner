"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Brand } from "@/components/chrome/Brand";
import { AuditPanel } from "@/components/planner/audit/AuditPanel";
import {
  type ProgramOption,
  planSubtitle,
} from "@/components/planner/shell/PlannerShell";
import { Timeline } from "@/components/planner/timeline/Timeline";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { useAuthState } from "@/lib/auth/store";
import type { Course } from "@/lib/courses/types";
import { logError } from "@/lib/log";
import { toSnapshot } from "@/lib/plan/server/serialize";
import type { ServerPlan } from "@/lib/plan/server/types";
import { savePlan } from "@/lib/plan/storage";
import { usePlanList } from "@/lib/plan/sync/usePlanList";
import type { LocalPlan } from "@/lib/plan/types";
import { PLAN_SCHEMA_VERSION } from "@/lib/plan/types";
import { issuesBySlot, validatePlan } from "@/lib/plan/validate";
import { joinProgramNames } from "@/lib/programs";

interface Props {
  plan: ServerPlan;
  catalog: Course[];
  programOptions: ProgramOption[];
}

/**
 * Public read-only view of a shared plan, mounted from `/p/[shareToken]`.
 * Unlike PlannerShell: no auth/sync hooks, mutation handlers, sidebar, or
 * modals. Reuses Timeline + AuditPanel by adapting the ServerPlan to a
 * LocalPlan-shaped value (both already accept LocalPlan).
 */
export function SharedPlanView({ plan, catalog, programOptions }: Props) {
  const router = useRouter();
  const { isAuthed, ready } = useAuthState();
  const { create } = usePlanList({ isAuthed });
  const [busy, setBusy] = useState(false);

  // Adapter: ServerPlan → LocalPlan. Only schemaVersion + stream defaulting
  // differ (server stream can be null; LocalPlan's enum can't).
  const localPlan = useMemo<LocalPlan>(
    () => ({
      schemaVersion: PLAN_SCHEMA_VERSION,
      programIds: plan.programIds,
      specializationIds: plan.specializationIds,
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

  const programName = joinProgramNames(
    localPlan.programIds,
    (id) => programOptions.find((p) => p.id === id)?.name,
    "—",
  );

  // "Duplicate to my plans" (mirrors WelcomeFlow's build): authed → server copy
  // and route to it; anon → seed the local demo plan. Mint fresh slot ids
  // either way to avoid PK conflicts on the seeded insert.
  async function onDuplicate() {
    if (busy) return;
    setBusy(true);
    try {
      if (isAuthed) {
        const snapshot = toSnapshot(localPlan);
        const fresh = {
          ...snapshot,
          slots: snapshot.slots.map((s) => ({ ...s, id: crypto.randomUUID() })),
        };
        const id = await create(`${plan.name} (copy)`, fresh);
        if (id) router.push(`/plan?planId=${id}`);
        else setBusy(false);
      } else {
        savePlan({
          ...localPlan,
          slots: localPlan.slots.map((s) => ({
            ...s,
            id: crypto.randomUUID(),
          })),
        });
        router.push("/plan");
      }
    } catch (err) {
      logError("Failed to duplicate plan", err);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-line bg-bg/90 backdrop-blur px-4 py-3 shadow-card-sm">
        <div className="flex items-center gap-3 min-w-0">
          <Brand href="/" />
          <span className="hidden sm:block h-5 w-px bg-line-2" aria-hidden />
          <div className="flex flex-col min-w-0">
            <span className="font-semibold truncate" title={plan.name}>
              {plan.name}
            </span>
            <span className="u-small truncate">
              {programName} · {planSubtitle(localPlan)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Pill>Shared · read-only</Pill>
          <Button
            variant="primary"
            size="md"
            onClick={onDuplicate}
            disabled={busy || !ready}
          >
            {busy ? "Duplicating…" : "Duplicate to my plans"}
          </Button>
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
        <AuditPanel plan={localPlan} catalog={catalog} />
      </div>
    </div>
  );
}

function noop(): void {}
