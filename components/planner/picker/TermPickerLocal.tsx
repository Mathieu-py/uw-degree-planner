"use client";

import Link from "next/link";
import { useState } from "react";
import { buttonClasses } from "@/components/ui/buttonClasses";
import type { Course } from "@/lib/courses/types";
import { runAddToPlanState } from "@/lib/plan/commitAddCourse";
import { loadPlan, savePlan } from "@/lib/plan/storage";
import type { LocalPlan, PlanSlot } from "@/lib/plan/types";
import { ProgramBlockedBody } from "./CourseTermModalShell";
import { TermOptionList } from "./TermOptionList";
import { useTermOptions } from "./termOptions";

/**
 * Signed-out add flow: the user has a single local plan in localStorage. Runs
 * the per-term eligibility check and writes the course into the chosen term.
 */
export function TermPickerLocal({
  course,
  onAdded,
  justAdded,
}: {
  course: Course;
  onAdded: (label: string) => void;
  justAdded: boolean;
}) {
  const [plan, setPlan] = useState<LocalPlan | null>(() => loadPlan());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { options, alreadyIn, blocked } = useTermOptions(
    course,
    plan?.slots,
    plan,
  );

  async function addTo(slot: PlanSlot, label: string) {
    if (saving || !plan) return;
    setSaveError(null);
    // savePlan re-stamps updatedAt; a failed write (localStorage full/disabled)
    // surfaces a banner and isn't reflected.
    await runAddToPlanState({
      plan,
      slot,
      course,
      label,
      setSaving,
      persist: (p) =>
        savePlan(p)
          ? { ok: true }
          : {
              ok: false,
              error:
                "Couldn't save to this browser — storage may be full or disabled.",
            },
      onSaved: setPlan,
      onAdded,
      onError: setSaveError,
    });
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

  // A program/faculty block closes the course to the whole plan — state it once
  // rather than showing every term disabled.
  if (blocked) return <ProgramBlockedBody />;

  return (
    <>
      <TermOptionList
        options={options}
        alreadyIn={alreadyIn}
        justAdded={justAdded}
        busy={saving}
        onPick={addTo}
      />
      {saveError ? (
        <p className="rounded-[8px] bg-danger-soft text-danger text-xs px-3 py-2">
          {saveError}
        </p>
      ) : null}
    </>
  );
}
