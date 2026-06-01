import type { LocalPlan, SlotCourse } from "@/lib/plan/types";

/**
 * Pure slot-course edits shared by every mutation path in the planner: the
 * course picker, the chip remove button, and drag-and-drop ({@link
 * import("@/lib/plan/dnd").applyCourseDrop}).
 *
 * Both helpers return the **same plan reference** on a no-op so callers can
 * skip a redundant save — `setPlan` persists unconditionally. Course codes are
 * matched and stored in catalog (lowercase) form.
 */

/** Append `course` to slot `slotId`, deduping by code. No-op if the slot is missing or already holds the code. */
export function addCourseToSlot(
  plan: LocalPlan,
  slotId: string,
  course: SlotCourse,
): LocalPlan {
  const code = course.code.toLowerCase();
  const target = plan.slots.find((s) => s.id === slotId);
  if (!target || target.courses.some((c) => c.code === code)) return plan;
  const added: SlotCourse = { ...course, code };
  return {
    ...plan,
    slots: plan.slots.map((s) =>
      s.id === slotId ? { ...s, courses: [...s.courses, added] } : s,
    ),
  };
}

/** Remove the course `code` from slot `slotId`. No-op if the slot or course is absent. */
export function removeCourseFromSlot(
  plan: LocalPlan,
  slotId: string,
  code: string,
): LocalPlan {
  const lc = code.toLowerCase();
  const target = plan.slots.find((s) => s.id === slotId);
  if (!target?.courses.some((c) => c.code === lc)) return plan;
  return {
    ...plan,
    slots: plan.slots.map((s) =>
      s.id === slotId
        ? { ...s, courses: s.courses.filter((c) => c.code !== lc) }
        : s,
    ),
  };
}
