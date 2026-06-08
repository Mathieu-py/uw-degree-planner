import { Suspense } from "react";
import { PlannerShell } from "@/components/planner/shell/PlannerShell";
import { PlannerSkeleton } from "@/components/states/PlannerSkeleton";
import { loadTerm } from "@/lib/courses/data";
import { getProgramOptions, PROGRAMS } from "@/lib/programs";
import { PINNED_TERM } from "@/lib/terms";

export const metadata = {
  title: "Plan your degree",
};

export default async function PlanPage() {
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
    <div className="mx-auto w-full max-w-screen-2xl px-6 sm:px-8 lg:px-12 py-4 lg:pb-0 flex flex-col gap-3 lg:h-[calc(100dvh-7rem)] lg:overflow-hidden">
      {/* Next 16 requires a Suspense boundary around any useSearchParams subtree
          (PlannerShell reads `?planId=…`), else the route goes CSR-only. */}
      <Suspense fallback={<PlannerSkeleton />}>
        <PlannerShell
          programOptions={programOptions}
          specializationsByProgram={specializationsByProgram}
          catalog={catalog}
        />
      </Suspense>
    </div>
  );
}
