import { useCallback, useMemo, useRef, useState } from "react";
import type { Course } from "@/lib/courses/types";
import { eligibleSlotIdsForCourse } from "@/lib/plan/eligibleTerms";
import { removeCourseFromSlot } from "@/lib/plan/mutateSlots";
import type { LocalPlan } from "@/lib/plan/types";
import type { ProgramIdentity } from "@/lib/programs";

interface Args {
  plan: LocalPlan | null;
  catalogByCode: ReadonlyMap<string, Course>;
  programs: ProgramIdentity[];
  programReferenced: ReadonlySet<string>;
}

/**
 * Timeline drag-highlight state, kept out of PlannerShell to mirror the
 * usePlannerModals/usePlanEditors split. Eligibility runs against the live
 * `plan` (the drop surface), not a deferred copy, so tinting tracks the drop.
 */
export function useDragEligibility({
  plan,
  catalogByCode,
  programs,
  programReferenced,
}: Args) {
  // The dragged audit chip, so the timeline can tint its eligible terms.
  const [draggingAddCode, setDraggingAddCode] = useState<string | null>(null);
  // A placed course being dragged between terms (code + its slot), so the same
  // highlight runs on a move, not just an add.
  const [movingCourse, setMovingCourse] = useState<{
    code: string;
    fromSlotId: string;
  } | null>(null);
  // A drop can unmount the source chip before `dragend` fires, leaving the flag
  // stale. A drop yields a new `plan` ref, so clear it on any plan change.
  const planRef = useRef(plan);
  if (planRef.current !== plan) {
    planRef.current = plan;
    if (draggingAddCode !== null) setDraggingAddCode(null);
    if (movingCourse !== null) setMovingCourse(null);
  }
  const handleAddDragStart = useCallback(
    (code: string) => setDraggingAddCode(code),
    [],
  );
  const handleAddDragEnd = useCallback(() => setDraggingAddCode(null), []);
  const handleMoveDrag = useCallback(
    (moving: { code: string; fromSlotId: string } | null) =>
      setMovingCourse(moving),
    [],
  );
  // Null when idle so the timeline skips the work. A move is judged against the
  // plan WITHOUT the in-flight course, else it reads as "already placed"
  // everywhere and its own slot satisfies its prereqs.
  const eligibleSlotIds = useMemo(() => {
    if (!plan) return null;
    if (draggingAddCode) {
      return eligibleSlotIdsForCourse(
        plan,
        draggingAddCode,
        catalogByCode,
        programs,
        programReferenced,
      );
    }
    if (movingCourse) {
      const without = removeCourseFromSlot(
        plan,
        movingCourse.fromSlotId,
        movingCourse.code,
      );
      return eligibleSlotIdsForCourse(
        without,
        movingCourse.code,
        catalogByCode,
        programs,
        programReferenced,
      );
    }
    return null;
  }, [
    draggingAddCode,
    movingCourse,
    plan,
    catalogByCode,
    programs,
    programReferenced,
  ]);
  const auditDrag = useMemo(
    () => ({
      draggingCode: draggingAddCode,
      onStart: handleAddDragStart,
      onEnd: handleAddDragEnd,
    }),
    [draggingAddCode, handleAddDragStart, handleAddDragEnd],
  );

  return { eligibleSlotIds, auditDrag, handleMoveDrag };
}
