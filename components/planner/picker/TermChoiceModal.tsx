"use client";

import { useCallback, useState } from "react";
import type { Course } from "@/lib/courses/types";
import { useModalExit } from "@/lib/hooks/useModalExit";
import type { LocalPlan, PlanSlot } from "@/lib/plan/types";
import { CourseTermModalShell } from "./CourseTermModalShell";
import { TermOptionList } from "./TermOptionList";
import { useTermOptions } from "./termOptions";

/**
 * Planner term picker for a single, already-chosen course (the audit drill-in
 * flow). The audit names the course — a missing-requirement chip — so the only
 * decision left is which term to drop it into. Shares the catalog add flow's
 * chrome ({@link CourseTermModalShell}) and per-term eligibility list
 * ({@link computeTermOptions} + {@link TermOptionList}); ineligible and
 * occupied terms render disabled.
 */
export function TermChoiceModal({
  course,
  plan,
  onPick,
  onClose,
}: {
  course: Course;
  plan: LocalPlan;
  /** Commit the add: the chosen academic slot for `course`. */
  onPick: (slot: PlanSlot) => void;
  onClose: () => void;
}) {
  const { isClosing, handleClose, animateOut } = useModalExit(onClose);
  const [addedTo, setAddedTo] = useState<string | null>(null);

  const { options, alreadyIn } = useTermOptions(course, plan.slots, plan);

  // Play the exit animation before committing so the add+unmount lands once the
  // modal has visually dismissed (and a double-tap can't double-add).
  const handlePick = useCallback(
    async (slot: PlanSlot, label: string) => {
      if (alreadyIn !== null) return;
      setAddedTo(label);
      await animateOut();
      onPick(slot);
    },
    [alreadyIn, animateOut, onPick],
  );

  return (
    <CourseTermModalShell
      course={course}
      heading="Add to which term?"
      titleId="term-choice-title"
      isClosing={isClosing}
      onClose={handleClose}
      addedTo={addedTo}
    >
      <TermOptionList
        options={options}
        alreadyIn={alreadyIn}
        justAdded={addedTo !== null}
        onPick={handlePick}
      />
    </CourseTermModalShell>
  );
}
