import { PlannerShell } from "@/components/planner/shell/PlannerShell";
import { loadTerm } from "@/lib/courses/data";
import { getProgramOptions, PROGRAMS } from "@/lib/programsRegistry";
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

  // Catalog for the slot picker — a single pinned term for now (expands to a
  // map once a term picker lands). Descriptions live in a sibling file.
  const catalog = await loadTerm(PINNED_TERM);

  return (
    <PlannerShell
      planId={planId}
      programOptions={programOptions}
      specializationsByProgram={specializationsByProgram}
      catalog={catalog}
    />
  );
}
