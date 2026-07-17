"use client";

import Link from "next/link";
import { useState } from "react";
import { buttonClasses } from "@/components/ui/buttonClasses";
import type { Course } from "@/lib/courses/types";
import { applyAddToPlan } from "@/lib/plan/commitAddCourse";
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

  const { options, alreadyIn, blocked } = useTermOptions(
    course,
    plan?.slots,
    plan,
  );

  async function addTo(slot: PlanSlot, label: string) {
    if (saving || !plan) return;
    // Saving flips before the await so a double-click can't slip past the guard;
    // the core also re-runs the placed/block gates the buttons enforce (no bypass).
    setSaving(true);
    const applied = await applyAddToPlan(plan, slot, course);
    if (applied.status !== "added") {
      setSaving(false);
      return;
    }
    // Only reflect the add and report success if the write stuck (localStorage
    // can be full/unavailable). savePlan re-stamps updatedAt itself.
    if (!savePlan(applied.plan)) {
      setSaving(false);
      return;
    }
    setPlan(applied.plan);
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

  // A program/faculty block closes the course to the whole plan — state it once
  // rather than showing every term disabled.
  if (blocked) return <ProgramBlockedBody />;

  return (
    <TermOptionList
      options={options}
      alreadyIn={alreadyIn}
      justAdded={justAdded}
      busy={saving}
      onPick={addTo}
    />
  );
}
