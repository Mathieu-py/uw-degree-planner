import { Suspense } from "react";
import { PlannerShell } from "@/components/planner/shell/PlannerShell";
import { loadTerm } from "@/lib/courses/data";
import { PROGRAMS } from "@/lib/programs";
import { PINNED_TERM } from "@/lib/terms";

export const metadata = {
  title: "Plan your degree · UW Degree Planner",
};

export default async function PlanPage() {
  // Server: pass the sorted program list down so the client doesn't ship the
  // entire programs.json again. PROGRAMS is already imported in the bundle
  // server-side; the small (id, name, kind) digest is all the planner UI needs
  // until a slot picker opens.
  const programOptions = Object.entries(PROGRAMS)
    .map(([id, p]) => ({ id, name: p.name, kind: p.kind }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Per-program specialization digest for the Plan Settings modal — only
  // slug + name are shipped to the client; full spec rule trees stay server-side.
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

  // Catalog for the slot picker. Today we ship a single pinned term; once a
  // term picker / multi-term snapshots land, this expands to a map.
  const catalog = await loadTerm(PINNED_TERM);

  return (
    <div className="mx-auto w-full max-w-screen-2xl px-6 sm:px-8 lg:px-12 py-4 flex flex-col gap-3">
      {/*
        Next 16 requires a Suspense boundary around any subtree that calls
        useSearchParams (PlannerShell reads `?planId=…`), otherwise the
        whole route is forced into CSR-only mode at build.
      */}
      <Suspense
        fallback={
          <div className="h-96 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 animate-pulse" />
        }
      >
        <PlannerShell
          programOptions={programOptions}
          specializationsByProgram={specializationsByProgram}
          catalog={catalog}
        />
      </Suspense>
    </div>
  );
}
