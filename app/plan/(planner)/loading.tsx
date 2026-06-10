import { PlannerSkeleton } from "@/components/states/PlannerSkeleton";

// Loading fallback for the planner routes. The page wrapper is supplied by the
// route-group layout, so this only renders the skeleton itself.
export default function PlanLoading() {
  return <PlannerSkeleton />;
}
