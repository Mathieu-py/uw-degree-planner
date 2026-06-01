"use client";

import { useCallback, useMemo, useState } from "react";
import { CourseTermModalShell } from "@/components/catalog/CourseTermModalShell";
import { TermOptionList } from "@/components/catalog/TermOptionList";
import {
  alreadyInLabel,
  computeTermOptions,
} from "@/components/catalog/termOptions";
import type { Course } from "@/lib/courses/types";
import { useModalExit } from "@/lib/hooks/useModalExit";
import type { LocalPlan, PlanSlot } from "@/lib/plan/types";
import { parsePrereqs } from "@/lib/prereqs/parse";

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

  const code = course.code.toLowerCase();
  const prereqNode = useMemo(
    () => parsePrereqs(course.prereqs),
    [course.prereqs],
  );
  const options = useMemo(
    () => computeTermOptions(plan.slots, prereqNode),
    [plan.slots, prereqNode],
  );
  const alreadyIn = alreadyInLabel(plan.slots, code);

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
