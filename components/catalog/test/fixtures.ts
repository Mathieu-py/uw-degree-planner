import type { Course } from "@/lib/courses/types";
import type { PlanSlot } from "@/lib/plan/types";

/** A minimal valid `Course`; override any field via `over`. */
export function makeCourse(over: Partial<Course> = {}): Course {
  return {
    id: 1,
    code: "CS246",
    name: "Object-Oriented Software Development",
    prereqs: null,
    coreqs: null,
    antireqs: null,
    rating: null,
    sections: [],
    prefix: "cs",
    level: 200,
    hasSeats: true,
    ...over,
  };
}

/** A `PlanSlot` with sane defaults; `id` and `position` are required. */
export function slot(
  over: Partial<PlanSlot> & Pick<PlanSlot, "id" | "position">,
): PlanSlot {
  return { termId: null, isCoop: false, courses: [], ...over };
}
