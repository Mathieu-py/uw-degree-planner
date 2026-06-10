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
 * Resolve a bare `/plan` (no `?planId`) to a destination:
 *   - signed in → most recent plan, or /plan/new if none
 *   - signed out, no local plan once hydrated → /plan/new
 * No-op when a planId is present.
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
    if (planId !== null) return;
    if (isAuthed) {
      if (!plans) return; // still loading
      if (plans.length === 0) {
        router.replace("/plan/new");
        return;
      }
      router.replace(`/plan/${plans[0].id}`);
      return;
    }
    // Signed out: redirect to the create flow only once we know there's no
    // local plan (hydrated && null), never mid-load.
    if (hydrated && !plan) router.replace("/plan/new");
  }, [isAuthed, planId, plans, hydrated, plan, router]);
}
