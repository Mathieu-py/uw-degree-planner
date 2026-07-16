"use client";

import { useCallback, useState } from "react";
import { useAuthState } from "@/lib/auth/store";
import type { Course } from "@/lib/courses/types";
import { useModalExit } from "@/lib/hooks/useModalExit";
import { CourseTermModalShell, StatusBody } from "./CourseTermModalShell";
import { TermPickerAuthed, type TermPickerStep } from "./TermPickerAuthed";
import { TermPickerLocal } from "./TermPickerLocal";

/**
 * Course-first "Add" flow (catalog / course detail page): the course is fixed
 * and the user chooses plan + term here. The inverse is the slot-first
 * {@link SlotPicker} (term fixed, course chosen). Both pickers and the detail
 * page's one-click {@link lib/plan/commitAddCourse} variant gate and mutate
 * through the shared `applyAddToPlan` core.
 *
 * Signed-out users edit their local plan; signed-in users pick a server plan
 * first, then the same term picker. `onAdded` fires after a successful add in
 * place of the default close.
 */
export function TermPicker({
  course,
  onClose,
  onAdded,
}: {
  course: Course;
  onClose: () => void;
  onAdded?: () => void;
}) {
  const { isClosing, handleClose, animateOut } = useModalExit(onClose);
  const { isAuthed, ready } = useAuthState();
  // Owned here (rather than inside the signed-in body) so the heading can be
  // derived for the modal header without a child→parent state round-trip.
  const [step, setStep] = useState<TermPickerStep>("plans");
  const [addedTo, setAddedTo] = useState<string | null>(null);

  // The plan-selection step is the only one that asks "which plan?"; every
  // other state (loading, signed-out, term step) asks "which term?".
  const heading =
    isAuthed && step === "plans" ? "Add to which plan?" : "Add to which term?";

  // A successful add dismisses the picker: record the label (footer flashes
  // "Added ✓" during exit), play the close animation, then `onAdded` or close.
  // Bodies call this only on success, so a failed save keeps the modal open.
  const handleAdded = useCallback(
    (label: string) => {
      setAddedTo(label);
      void animateOut().then(() => {
        if (onAdded) onAdded();
        else onClose();
      });
    },
    [animateOut, onClose, onAdded],
  );

  return (
    <CourseTermModalShell
      course={course}
      heading={heading}
      titleId="term-picker-title"
      isClosing={isClosing}
      onClose={handleClose}
      addedTo={addedTo}
    >
      {!ready ? (
        <StatusBody>Loading…</StatusBody>
      ) : isAuthed ? (
        <TermPickerAuthed
          course={course}
          step={step}
          setStep={setStep}
          onAdded={handleAdded}
          justAdded={addedTo !== null}
        />
      ) : (
        <TermPickerLocal
          course={course}
          onAdded={handleAdded}
          justAdded={addedTo !== null}
        />
      )}
    </CourseTermModalShell>
  );
}
