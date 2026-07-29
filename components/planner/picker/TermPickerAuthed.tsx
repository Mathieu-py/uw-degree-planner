"use client";

import Link from "next/link";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { buttonClasses } from "@/components/ui/buttonClasses";
import { Icon } from "@/components/ui/Icon";
import { isProgramBlocked } from "@/lib/courses/courseEligibility";
import type { Course } from "@/lib/courses/types";
import { describeActionError } from "@/lib/format";
import { useKeyedAsync } from "@/lib/hooks/useKeyedAsync";
import { runAddToPlanState } from "@/lib/plan/commitAddCourse";
import {
  loadServerPlan,
  plansContainingCourse,
  savePlanState,
} from "@/lib/plan/server/actions";
import { toSnapshot } from "@/lib/plan/server/serialize";
import type { ServerPlan } from "@/lib/plan/server/types";
import { usePlanList } from "@/lib/plan/sync/usePlanList";
import type { PlanSlot } from "@/lib/plan/types";
import { programDetail } from "@/lib/programs/detail";
import { programIdentities } from "@/lib/programs/meta";
import { useProgramsDetail } from "@/lib/programs/usePlanPrograms";
import type { ActionResult } from "@/lib/server/actions";
import {
  ErrorBody,
  ProgramBlockedBody,
  StatusBody,
} from "./CourseTermModalShell";
import { optionButtonClasses, TermOptionList } from "./TermOptionList";
import { useTermOptions } from "./termOptions";

export type TermPickerStep = "plans" | "term";

/**
 * Signed-in add flow: pick a server plan, then a term within it. `step` is
 * owned by the parent {@link TermPicker} so it can title the modal.
 */
export function TermPickerAuthed({
  course,
  step,
  setStep,
  onAdded,
  justAdded,
}: {
  course: Course;
  step: TermPickerStep;
  setStep: Dispatch<SetStateAction<TermPickerStep>>;
  onAdded: (label: string) => void;
  justAdded: boolean;
}) {
  const code = course.code.toLowerCase();
  const { plans, loading, loadError: listError, refetch } = usePlanList(true);

  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Plans already holding this course show disabled; a failed lookup leaves all selectable.
  const [containing, setContaining] = useState<Set<string> | null>(null);

  // Keyed load drops stale responses so serverPlan can't desync from
  // selectedPlanId; not-found maps to an error so `success` carries a real plan.
  const loadPlanById = useCallback(
    async (id: string): Promise<ActionResult<ServerPlan>> => {
      const res = await loadServerPlan(id);
      if (!res.ok) return res;
      if (res.data === null) return { ok: false, error: "not_found" };
      return { ok: true, data: res.data };
    },
    [],
  );
  const load = useKeyedAsync(selectedPlanId, loadPlanById);
  const serverPlan = load.state.status === "success" ? load.state.data : null;
  const loadingPlan = load.state.status === "loading";
  const loadError = load.state.status === "error" ? load.state.error : null;

  // Options stay empty until a plan resolves; `blocked` guards the term step
  // in the single-plan auto-advance case (the plan step is skipped there).
  const { options, alreadyIn, blocked } = useTermOptions(
    course,
    serverPlan?.slots,
    serverPlan,
  );

  // Program eligibility is per-plan, not per-term, so it's decided here;
  // blockedPlanIds recomputes as program detail lands.
  const summaryProgramIds = useMemo(
    () => (plans ?? []).flatMap((p) => p.programIds ?? []),
    [plans],
  );
  const detail = useProgramsDetail(summaryProgramIds);
  const blockedPlanIds = useMemo(() => {
    const set = new Set<string>();
    for (const p of plans ?? []) {
      // Refs only suppress, so unloaded detail = judged with none (fail-safe).
      const blocked = isProgramBlocked(course, {
        programs: programIdentities(p.programIds, p.specializationIds),
        programReferenced: detail.loaded
          ? programDetail.planReferencedCodes(p.programIds, p.specializationIds)
          : undefined,
      });
      if (blocked) set.add(p.id);
    }
    return set;
  }, [plans, course, detail]);

  // One RLS-scoped read, keyed on the course, so it runs once per picker open.
  useEffect(() => {
    let live = true;
    void plansContainingCourse(code)
      .then((res: ActionResult<string[]>) => {
        if (live) setContaining(res.ok ? new Set(res.data) : new Set());
      })
      // A transport-level rejection would otherwise leave the step stuck on
      // "Loading your plans…"; fall back to none, like an ok:false result.
      .catch(() => {
        if (live) setContaining(new Set());
      });
    return () => {
      live = false;
    };
  }, [code]);

  // Advance to the term step; useKeyedAsync handles loading and stale-drop.
  const selectPlan = useCallback(
    (planId: string) => {
      setSaveError(null);
      setStep("term");
      setSelectedPlanId(planId);
    },
    [setStep],
  );

  // Exactly one plan: skip the plan-picker step; `!selectedPlanId` stops re-runs.
  useEffect(() => {
    if (plans && plans.length === 1 && step === "plans" && !selectedPlanId) {
      selectPlan(plans[0].id);
    }
  }, [plans, step, selectedPlanId, selectPlan]);

  function backToPlans() {
    // Clearing the key resets the keyed load and drops in-flight responses.
    setStep("plans");
    setSelectedPlanId(null);
    setSaveError(null);
  }

  async function addTo(slot: PlanSlot, label: string) {
    if (saving || !serverPlan || !selectedPlanId) return;
    setSaveError(null);
    await runAddToPlanState({
      plan: serverPlan,
      slot,
      course,
      label,
      setSaving,
      // Full-plan REPLACE targeting the loaded plan's own id (not
      // selectedPlanId), so a desync can't write one plan's data into another.
      persist: async (p) => {
        const res = await savePlanState(p.id, toSnapshot(p));
        return res.ok ? { ok: true } : { ok: false, error: res.error };
      },
      // Keep terms disabled through the close animation (blocks a double-add).
      onSaved: load.setData,
      onAdded,
      onError: setSaveError,
    });
  }

  // ---- Plan-selection step ----
  if (step === "plans") {
    // Error before the null guard: a failed first load leaves plans null, so
    // checking null first would show "Loading" forever instead of the retry.
    if (listError && plans === null) {
      return (
        <ErrorBody
          message="Couldn't load your plans."
          onRetry={() => void refetch()}
        />
      );
    }
    if (plans === null || loading)
      return <StatusBody>Loading your plans…</StatusBody>;
    if (plans.length === 0) {
      return (
        <div className="flex flex-col gap-3 py-4 text-center">
          <p className="u-body">
            You don't have any plans yet. Create one to add courses.
          </p>
          <Link
            href="/plan/new"
            className={buttonClasses({
              variant: "primary",
              className: "self-center",
            })}
          >
            Create a plan
          </Link>
        </div>
      );
    }
    if (plans.length === 1) {
      // Auto-advance effect is firing; show the load placeholder, not the list.
      return <StatusBody>Loading plan…</StatusBody>;
    }
    // Wait for the membership lookup so held plans render disabled from the start.
    if (containing === null)
      return <StatusBody>Loading your plans…</StatusBody>;
    return (
      <>
        {plans.map((p) => {
          const has = containing.has(p.id);
          const isBlocked = blockedPlanIds.has(p.id);
          return (
            <button
              key={p.id}
              type="button"
              disabled={has || isBlocked}
              onClick={() => selectPlan(p.id)}
              className={optionButtonClasses}
            >
              <span className="flex min-w-0 flex-col">
                <span className="text-sm truncate">{p.name}</span>
                {has ? (
                  <span className="u-small text-met">Already in this plan</span>
                ) : isBlocked ? (
                  <span className="u-small text-danger">
                    Not open to your program
                  </span>
                ) : null}
              </span>
              <Icon name="external" size="sm" aria-hidden="true" />
            </button>
          );
        })}
      </>
    );
  }

  // ---- Term-selection step ----
  const showBack = (plans?.length ?? 0) > 1;

  return (
    <>
      {showBack ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={backToPlans}
          disabled={saving}
          className="self-start -ml-1"
        >
          ← Plans
        </Button>
      ) : null}
      {loadingPlan ? (
        <StatusBody>Loading plan…</StatusBody>
      ) : loadError ? (
        <ErrorBody
          message={
            loadError === "not_found"
              ? "That plan is no longer available."
              : describeActionError(loadError)
          }
          onRetry={selectedPlanId ? load.reload : undefined}
        />
      ) : serverPlan ? (
        blocked ? (
          // Only reachable via single-plan auto-advance; blocked plans aren't selectable above.
          <ProgramBlockedBody />
        ) : (
          <TermOptionList
            options={options}
            alreadyIn={alreadyIn}
            justAdded={justAdded}
            busy={saving}
            onPick={addTo}
          />
        )
      ) : null}
      {saveError ? <Alert>{describeActionError(saveError)}</Alert> : null}
    </>
  );
}
