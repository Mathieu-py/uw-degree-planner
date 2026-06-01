"use client";

import Link from "next/link";
import { useState } from "react";
import { buttonClasses } from "@/components/ui/buttonClasses";
import type { Course } from "@/lib/courses/types";
import { addCourseToSlot } from "@/lib/plan/mutateSlots";
import { loadPlan, savePlan } from "@/lib/plan/storage";
import type { LocalPlan, PlanSlot } from "@/lib/plan/types";
import { TermOptionList } from "./TermOptionList";
import { alreadyInLabel, useTermOptions } from "./termOptions";

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
  const code = course.code.toLowerCase();
  const [plan, setPlan] = useState<LocalPlan | null>(() => loadPlan());

  const { options, alreadyIn } = useTermOptions(course, plan?.slots, plan);

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
