import { PlannerSkeleton } from "@/components/states/PlannerSkeleton";
import { PLANNER_CONTAINER_CLASS } from "./(planner)/layout";

// Loading boundary for the whole `/plan` segment, placed ABOVE the `(planner)`
// group layout on purpose: a boundary above the shared layout is invisible to
// client navigation between sibling routes, so `/plan/[a]` → `/plan/[b]` holds
// the current plan on screen until the next server load finishes instead of
// flashing this skeleton. It still covers the first load. Sitting above the group
// layout, it doesn't inherit that container — reuse the same one so it aligns.
export default function PlanLoading() {
  return (
    <div className={PLANNER_CONTAINER_CLASS}>
      <PlannerSkeleton />
    </div>
  );
}
