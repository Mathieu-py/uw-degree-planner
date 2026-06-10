import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { PlanSummary } from "@/lib/plan/server/types";
import type { LocalPlan } from "@/lib/plan/types";

interface RedirectArgs {
  isAuthed: boolean;
  planId: string | null;
  plans: PlanSummary[] | null;
  hydrated: boolean;
  plan: LocalPlan | null;
}

/**
 * Resolve the planner route to a destination:
 *   - signed in, bare `/plan` → most recent plan, or /plan/new if none
 *   - signed out, any `/plan/[planId]` → strip the id (no server plans exist
 *     for them, so the path id is meaningless) back to bare `/plan`
 *   - signed out, no local plan once hydrated → /plan/new
 * No-op for a signed-in user already on a specific `/plan/[planId]`.
 */
export function usePlannerRedirect({
  isAuthed,
  planId,
  plans,
  hydrated,
  plan,
}: RedirectArgs): void {
  const router = useRouter();
  useEffect(() => {
    if (isAuthed) {
      if (planId !== null) return; // a specific plan is selected: stay
      if (!plans) return; // still loading
      if (plans.length === 0) {
        router.replace("/plan/new");
        return;
      }
      router.replace(`/plan/${plans[0].id}`);
      return;
    }
    // Signed out: a path planId can't resolve to anything (their only plan is
    // the local one), so drop it rather than render the planner under a stale
    // id — which otherwise sticks on an empty skeleton with no plan to load.
    if (planId !== null) {
      router.replace("/plan");
      return;
    }
    // Redirect to the create flow only once we know there's no local plan
    // (hydrated && null), never mid-load.
    if (hydrated && !plan) router.replace("/plan/new");
  }, [isAuthed, planId, plans, hydrated, plan, router]);
}
