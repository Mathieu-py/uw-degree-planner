"use client";

import { useCallback, useState } from "react";
import { useAuthState } from "@/lib/auth/store";
import type { Course } from "@/lib/courses/types";
import { useModalExit } from "@/lib/hooks/useModalExit";
import { CourseTermModalShell } from "./CourseTermModalShell";
import { TermPickerAuthed, type TermPickerStep } from "./TermPickerAuthed";
import { TermPickerLocal } from "./TermPickerLocal";
import { StatusBody } from "./termPickerShared";

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
 *
 * `onAdded`, when given, fires after a successful add in place of the default
 * close — the course-detail "Add" flow uses it to redirect back to the catalog.
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

  // A successful add dismisses the picker: record the label (the footer flashes
  // "Added ✓" during the exit), play the close animation, then hand off to
  // `onAdded` if the caller wants to redirect, else just close. Bodies call this
  // only on success, so a failed server save keeps the modal open.
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
