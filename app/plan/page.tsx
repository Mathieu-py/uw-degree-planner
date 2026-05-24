import { PlannerShell } from "@/components/planner/PlannerShell";
import { loadTerm } from "@/lib/data";
import { PROGRAMS } from "@/lib/programs";
import { PINNED_TERM, termInfo } from "@/lib/terms";

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
  const catalogLabel = termInfo(PINNED_TERM)?.label ?? `Term ${PINNED_TERM}`;

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-10 flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <span className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Beta
          </span>
          <a
            href="mailto:feedback@example.com?subject=UW%20Degree%20Planner%20feedback"
            className="text-xs text-zinc-500 dark:text-zinc-400 underline-offset-4 hover:underline hover:text-zinc-950 dark:hover:text-zinc-50"
          >
            Report an issue
          </a>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">
          Plan your degree
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-2xl">
          Lay out every term of your degree on one screen. Upload your Quest
          transcript to bootstrap, or set up manually below.
        </p>
      </div>

      <PlannerShell
        programOptions={programOptions}
        specializationsByProgram={specializationsByProgram}
        catalog={catalog}
      />

      <footer className="text-xs text-zinc-500 dark:text-zinc-500 pt-2 border-t border-zinc-200 dark:border-zinc-900">
        Catalog: {catalogLabel}
      </footer>
    </div>
  );
}
