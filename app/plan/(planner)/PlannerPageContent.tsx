import { PlannerShell } from "@/components/planner/shell/PlannerShell";
import { PlannerSkeleton } from "@/components/states/PlannerSkeleton";
import { AuthGate } from "@/lib/auth/store";
import { loadTerm } from "@/lib/courses/data";
import { loadServerPlan } from "@/lib/plan/server/actions";
import { serverPlanToLocal } from "@/lib/plan/sync/serverPlan";
import type { LocalPlan } from "@/lib/plan/types";
import { getProgramOptions, PROGRAMS } from "@/lib/programs/registry";
import { PINNED_TERM } from "@/lib/terms";

/**
 * Server-rendered planner body, shared by bare `/plan` (no id → local plan or
 * redirect) and `/plan/[planId]` (server-resolved route param). The active plan
 * is a path segment, so no `useSearchParams` / `Suspense` boundary is needed —
 * `planId` threads straight through as a prop. The page wrapper lives in the
 * route-group layout.
 *
 * Lives in its own module (not a `page.tsx`) so both route entry points import
 * it without one page depending on another page's internals.
 */
export async function PlannerPageContent({
  planId,
}: {
  planId: string | null;
}) {
  // Sorted program list passed to the client so it doesn't re-ship
  // programs.json. The (id, name, kind) digest is all the UI needs pre-picker.
  const programOptions = getProgramOptions();

  // Per-program spec digest for Plan Settings — only slug + name ship; full
  // spec rule trees stay server-side.
  const specializationsByProgram: Record<
    string,
    Array<{ slug: string; name: string }>
  > = Object.fromEntries(
    Object.entries(PROGRAMS).map(([id, p]) => [
      id,
      (p.specializations ?? [])
        .map((s) => ({ slug: s.slug, name: s.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ]),
  );

  // Catalog for the slot picker (single pinned term for now). Load the active
  // plan alongside it so the Supabase round trip overlaps the catalog parse;
  // bare `/plan` has no server plan and the client falls back to localStorage.
  const [catalog, planResult] = await Promise.all([
    loadTerm(PINNED_TERM),
    planId !== null ? loadServerPlan(planId) : Promise.resolve(null),
  ]);
  const initialPlan: LocalPlan | null =
    planResult?.ok && planResult.data
      ? serverPlanToLocal(planResult.data)
      : null;
  // A failed load (vs. a clean not-found) so the shell offers a retry instead of
  // telling the user their plan was deleted.
  const initialLoadError =
    planResult && !planResult.ok ? planResult.error : null;

  // Key by planId so a plan switch remounts the shell with a fresh seed instead
  // of needing a derive-from-prop sync. The gate's fallback matches the route
  // loading.tsx skeleton, so one continuous skeleton runs from route load
  // through auth resolution.
  return (
    <AuthGate fallback={<PlannerSkeleton />}>
      <PlannerShell
        key={planId ?? "local"}
        planId={planId}
        initialPlan={initialPlan}
        initialLoadError={initialLoadError}
        programOptions={programOptions}
        specializationsByProgram={specializationsByProgram}
        catalog={catalog}
      />
    </AuthGate>
  );
}
