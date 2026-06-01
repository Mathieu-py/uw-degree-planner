"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { buttonClasses } from "@/components/ui/buttonClasses";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { useAuthState } from "@/lib/auth/store";
import type { Course } from "@/lib/courses/types";
import { formatCourseCode } from "@/lib/format";
import { useModalExit } from "@/lib/hooks/useModalExit";
import { addCourseToSlot } from "@/lib/plan/mutateSlots";
import {
  loadServerPlan,
  plansContainingCourse,
  savePlanState,
} from "@/lib/plan/server/actions";
import { toSnapshot } from "@/lib/plan/server/serialize";
import type { ActionResult, ServerPlan } from "@/lib/plan/server/types";
import { loadPlan, savePlan } from "@/lib/plan/storage";
import { usePlanList } from "@/lib/plan/sync/usePlanList";
import type { LocalPlan, PlanSlot } from "@/lib/plan/types";
import { parsePrereqs } from "@/lib/prereqs/parse";
import { TermOptionList } from "./TermOptionList";
import { alreadyInLabel, computeTermOptions } from "./termOptions";

/**
 * Catalog "Add" flow. The catalog has no target term, so this runs the prereq
 * check per academic term — a course is "missing prereqs" in early terms and
 * "eligible" once its prereqs sit in earlier terms. Adding writes the course
 * into the chosen term's slot.
 *
 * Signed-out users edit their single local plan (localStorage). Signed-in
 * users first pick which of their server-side plans to add to, then the same
 * term picker runs against that plan and the add is persisted with a server
 * round-trip (read-modify-write via `savePlanState`).
 */
export function TermPicker({
  course,
  onClose,
}: {
  course: Course;
  onClose: () => void;
}) {
  const { isClosing, handleClose, animateOut } = useModalExit(onClose);
  const { isAuthed, ready } = useAuthState();
  const [heading, setHeading] = useState("Add to which term?");
  const [addedTo, setAddedTo] = useState<string | null>(null);

  // A successful add dismisses the picker — there's nothing left to do on a
  // term once the course lands in it. We record the label (the footer flashes
  // "Added ✓" during the exit) and play the close animation. Bodies only call
  // this on success, so a failed server save keeps the modal open.
  const onAdded = useCallback(
    (label: string) => {
      setAddedTo(label);
      void animateOut().then(onClose);
    },
    [animateOut, onClose],
  );

  const titleId = "term-picker-title";
  const niceCode = formatCourseCode(course.code);

  return (
    <Modal
      isClosing={isClosing}
      onClose={handleClose}
      titleId={titleId}
      className="max-w-md"
    >
      <header className="border-b border-line px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-ink-3">
            {heading}
          </div>
          <h2 id={titleId} className="text-sm font-medium truncate">
            <span className="u-mono">{niceCode}</span> · {course.name}
          </h2>
        </div>
        <Button variant="icon" onClick={handleClose} aria-label="Close">
          <Icon name="close" size="md" aria-hidden="true" />
        </Button>
      </header>

      <div className="px-4 py-4 flex flex-col gap-2">
        {!ready ? (
          <StatusBody>Loading…</StatusBody>
        ) : isAuthed ? (
          <ServerTermBody
            course={course}
            setHeading={setHeading}
            onAdded={onAdded}
            justAdded={addedTo !== null}
          />
        ) : (
          <LocalTermBody
            course={course}
            onAdded={onAdded}
            justAdded={addedTo !== null}
          />
        )}
      </div>

      <footer className="border-t border-line px-4 py-2.5">
        <span className="u-small">
          {addedTo ? (
            <span className="text-met">Added to {addedTo} ✓</span>
          ) : (
            "Ineligible terms are disabled"
          )}
        </span>
      </footer>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Signed-out: single local plan in localStorage
// ---------------------------------------------------------------------------

function LocalTermBody({
  course,
  onAdded,
  justAdded,
}: {
  course: Course;
  onAdded: (label: string) => void;
  justAdded: boolean;
}) {
  const code = course.code.toLowerCase();
  const [plan, setPlan] = useState<LocalPlan | null>(() => loadPlan());

  const prereqNode = useMemo(
    () => parsePrereqs(course.prereqs),
    [course.prereqs],
  );
  const options = useMemo(
    () => (plan ? computeTermOptions(plan.slots, prereqNode) : []),
    [plan, prereqNode],
  );
  const alreadyIn = plan ? alreadyInLabel(plan.slots, code) : null;

  function addTo(slot: PlanSlot, label: string) {
    if (!plan) return;
    // A course belongs in exactly one term; the option buttons disable once
    // it's placed, but guard here too so the writer can never duplicate.
    if (alreadyInLabel(plan.slots, code) !== null) return;
    const next = addCourseToSlot(plan, slot.id, { code });
    if (next === plan) return;
    const stamped = { ...next, updatedAt: new Date().toISOString() };
    savePlan(stamped);
    setPlan(stamped);
    onAdded(label);
  }

  if (!plan) {
    return (
      <div className="flex flex-col gap-3 py-4 text-center">
        <p className="u-body">
          You don't have a local plan yet. Start one to add courses.
        </p>
        <Link
          href="/plan"
          className={buttonClasses({
            variant: "primary",
            className: "self-center",
          })}
        >
          Open the planner
        </Link>
      </div>
    );
  }

  return (
    <TermOptionList
      options={options}
      alreadyIn={alreadyIn}
      justAdded={justAdded}
      onPick={addTo}
    />
  );
}

// ---------------------------------------------------------------------------
// Signed-in: pick a server plan, then a term; persist via server round-trip
// ---------------------------------------------------------------------------

function ServerTermBody({
  course,
  setHeading,
  onAdded,
  justAdded,
}: {
  course: Course;
  setHeading: (heading: string) => void;
  onAdded: (label: string) => void;
  justAdded: boolean;
}) {
  const code = course.code.toLowerCase();
  const prereqNode = useMemo(
    () => parsePrereqs(course.prereqs),
    [course.prereqs],
  );
  const {
    plans,
    loading,
    error: listError,
    refetch,
  } = usePlanList({ isAuthed: true });

  const [step, setStep] = useState<"plans" | "term">("plans");
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

  useEffect(() => {
    setHeading(step === "plans" ? "Add to which plan?" : "Add to which term?");
  }, [step, setHeading]);

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

  const openPlan = useCallback(async (planId: string) => {
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
  }, []);

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
              className="flex items-center justify-between gap-3 rounded-[9px] border border-line px-3 py-2.5 text-left transition-colors hover:bg-bg-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
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
  const options = serverPlan
    ? computeTermOptions(serverPlan.slots, prereqNode)
    : [];
  const alreadyIn = serverPlan ? alreadyInLabel(serverPlan.slots, code) : null;

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

// ---------------------------------------------------------------------------
// Shared small bodies
// ---------------------------------------------------------------------------

function StatusBody({ children }: { children: React.ReactNode }) {
  return <p className="u-body py-4 text-center">{children}</p>;
}

function ErrorBody({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 py-4 text-center">
      <p className="rounded-[8px] bg-danger-soft text-danger text-xs px-3 py-2">
        {message}
      </p>
      {onRetry ? (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="self-center"
        >
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/** Humanize the error codes the plan server actions return. */
function serverActionError(code: string): string {
  switch (code) {
    case "not_authenticated":
      return "Your session expired — please sign in again.";
    case "snapshot_too_large":
      return "This plan is too large to save.";
    case "not_found":
    case "not_found_or_unauthorized":
      return "That plan is no longer available.";
    default:
      return "Couldn't save. Try again.";
  }
}
