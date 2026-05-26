import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SharedPlanView } from "@/components/planner/SharedPlanView";
import { loadTerm } from "@/lib/data";
import { loadSharedPlan } from "@/lib/plan/server/actions";
import { PROGRAMS } from "@/lib/programs";
import { PINNED_TERM } from "@/lib/terms";

interface PageProps {
  // Next 16: route params are async.
  params: Promise<{ shareToken: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { shareToken } = await params;
  const result = await loadSharedPlan(shareToken);
  const name = result.ok && result.data ? result.data.name : "Shared plan";
  return {
    title: `${name} · UW Degree Planner`,
    // Shared plans are link-only; don't surface them in search results.
    robots: { index: false, follow: false },
  };
}

export default async function SharedPlanPage({ params }: PageProps) {
  const { shareToken } = await params;
  const result = await loadSharedPlan(shareToken);
  if (!result.ok || !result.data) notFound();

  // Same digests as the main /plan route — kept tiny on the wire so the
  // shared view loads fast even for cold visitors.
  const programOptions = Object.entries(PROGRAMS)
    .map(([id, p]) => ({ id, name: p.name, kind: p.kind }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const catalog = await loadTerm(PINNED_TERM);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 lg:px-6 py-4">
      <SharedPlanView
        plan={result.data}
        catalog={catalog}
        programOptions={programOptions}
      />
    </div>
  );
}
