"use client";

import Link from "next/link";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useState,
} from "react";
import { Button } from "@/components/ui/Button";
import { buttonClasses } from "@/components/ui/buttonClasses";
import { Icon } from "@/components/ui/Icon";
import type { Course } from "@/lib/courses/types";
import { addCourseToSlot } from "@/lib/plan/mutateSlots";
import {
  loadServerPlan,
  plansContainingCourse,
  savePlanState,
} from "@/lib/plan/server/actions";
import { toSnapshot } from "@/lib/plan/server/serialize";
import type { ActionResult, ServerPlan } from "@/lib/plan/server/types";
import { usePlanList } from "@/lib/plan/sync/usePlanList";
import type { PlanSlot } from "@/lib/plan/types";
import { optionButtonClasses, TermOptionList } from "./TermOptionList";
import { alreadyInLabel, useTermOptions } from "./termOptions";
import { ErrorBody, StatusBody, serverActionError } from "./termPickerShared";

export type TermPickerStep = "plans" | "term";

/**
 * Signed-in add flow: pick which of the user's server-side plans to add to,
 * then pick a term within it; the add is persisted with a server round-trip
 * (read-modify-write via `savePlanState`). `step` is owned by the parent
 * {@link TermPicker} so it can title the modal ("which plan?" vs "which term?")
 * without a state round-trip.
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
  const {
    plans,
    loading,
    error: listError,
    refetch,
  } = usePlanList({ isAuthed: true });

  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [serverPlan, setServerPlan] = useState<ServerPlan | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Plan ids that already contain this course — those plans are shown disabled
  // in the picker. Null until the lookup resolves; greying is an enhancement,
  // so a failed lookup just leaves every plan selectable.
  const [containing, setContaining] = useState<Set<string> | null>(null);

  // serverPlan is null during the plan-picker step and mid-load, so options
  // come back empty until a plan resolves — exactly the term step's gate.
  const { options, alreadyIn } = useTermOptions(
    course,
    serverPlan?.slots,
    serverPlan,
  );

  // Which of the user's plans already hold this course? One RLS-scoped read,
  // keyed only on the course, so it runs once when the picker opens.
  useEffect(() => {
    let live = true;
    void plansContainingCourse(code).then((res: ActionResult<string[]>) => {
      if (live) setContaining(res.ok ? new Set(res.data) : new Set());
    });
    return () => {
      live = false;
    };
  }, [code]);

  const openPlan = useCallback(
    async (planId: string) => {
      setSelectedPlanId(planId);
      setServerPlan(null);
      setLoadError(null);
      setSaveError(null);
      setStep("term");
      setLoadingPlan(true);
      const res = await loadServerPlan(planId);
      setLoadingPlan(false);
      if (!res.ok) {
        setLoadError(res.error);
        return;
      }
      if (!res.data) {
        setLoadError("not_found");
        return;
      }
      setServerPlan(res.data);
    },
    [setStep],
  );

  // Exactly one plan: skip the plan-picker step entirely (mirrors the
  // signed-out path, which has no plan selection). Fires once — the
  // `!selectedPlanId` guard keeps it from re-running after it advances.
  useEffect(() => {
    if (plans && plans.length === 1 && step === "plans" && !selectedPlanId) {
      void openPlan(plans[0].id);
    }
  }, [plans, step, selectedPlanId, openPlan]);

  function backToPlans() {
    setStep("plans");
    setSelectedPlanId(null);
    setServerPlan(null);
    setLoadError(null);
    setSaveError(null);
  }

  async function addTo(slot: PlanSlot, label: string) {
    if (saving || !serverPlan || !selectedPlanId) return;
    if (alreadyInLabel(serverPlan.slots, code) !== null) return;
    const updated = addCourseToSlot(serverPlan, slot.id, { code });
    if (updated === serverPlan) return;
    setSaving(true);
    setSaveError(null);
    // savePlanState is a full atomic REPLACE, so we send the entire updated
    // plan — never a partial — to avoid clobbering its other courses.
    const res = await savePlanState(selectedPlanId, toSnapshot(updated));
    setSaving(false);
    if (!res.ok) {
      setSaveError(res.error);
      return;
    }
    setServerPlan(updated);
    onAdded(label);
  }

  // ---- Plan-selection step ----
  if (step === "plans") {
    if (plans === null || loading)
      return <StatusBody>Loading your plans…</StatusBody>;
    if (listError) {
      return (
        <ErrorBody
          message="Couldn't load your plans."
          onRetry={() => void refetch()}
        />
      );
    }
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
    // Wait for the membership lookup so plans already holding the course render
    // disabled from the start rather than flipping after a beat.
    if (containing === null)
      return <StatusBody>Loading your plans…</StatusBody>;
    return (
      <>
        {plans.map((p) => {
          const has = containing.has(p.id);
          return (
            <button
              key={p.id}
              type="button"
              disabled={has}
              onClick={() => void openPlan(p.id)}
              className={optionButtonClasses}
            >
              <span className="flex min-w-0 flex-col">
                <span className="text-sm truncate">{p.name}</span>
                {has ? (
                  <span className="u-small text-met">Already in this plan</span>
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
              : serverActionError(loadError)
          }
          onRetry={
            selectedPlanId ? () => void openPlan(selectedPlanId) : undefined
          }
        />
      ) : serverPlan ? (
        <TermOptionList
          options={options}
          alreadyIn={alreadyIn}
          justAdded={justAdded}
          busy={saving}
          onPick={addTo}
        />
      ) : null}
      {saveError ? (
        <p className="rounded-[8px] bg-danger-soft text-danger text-xs px-3 py-2">
          {serverActionError(saveError)}
        </p>
      ) : null}
    </>
  );
}
