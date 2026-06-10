import { PlannerPageContent } from "./PlannerPageContent";

// Bare `/plan`: no id in the path. Renders the signed-out local plan, or
// redirects signed-in users to their most recent plan / `/plan/new` (see
// usePlannerRedirect). A specific plan lives at `/plan/[planId]`.
export default function PlanPage() {
  return <PlannerPageContent planId={null} />;
}
