import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { SharedPlanView } from "@/components/planner/viewer/SharedPlanView";
import { loadTerm } from "@/lib/courses/data";
import { loadSharedPlan } from "@/lib/plan/server/actions";
import type { Program } from "@/lib/programs";
import { getProgramOptions, PROGRAMS } from "@/lib/programsRegistry";
import { PINNED_TERM } from "@/lib/terms";

// generateMetadata and the page both need the shared plan; React.cache dedups
// the RPC so cold visitors pay one round trip.
const loadSharedPlanCached = cache(loadSharedPlan);

interface PageProps {
  // Next 15+: route params are async.
  params: Promise<{ shareToken: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { shareToken } = await params;
  const result = await loadSharedPlanCached(shareToken);
  const name = result.ok && result.data ? result.data.name : "Shared plan";
  return {
    title: name,
    // Shared plans are link-only; don't surface them in search results.
    robots: { index: false, follow: false },
  };
}

export default async function SharedPlanPage({ params }: PageProps) {
  const { shareToken } = await params;
  // The catalog read is independent of the plan RPC — overlap the local file
  // parse with the network round trip.
  const [result, catalog] = await Promise.all([
    loadSharedPlanCached(shareToken),
    loadTerm(PINNED_TERM),
  ]);
  if (!result.ok || !result.data) notFound();
  const plan = result.data;

  // Same tiny digest as /plan, so the shared view loads fast for cold visitors.
  const programOptions = getProgramOptions();

  // Seed the audit's per-program detail server-side, so the shared view renders
  // the audit in the initial HTML — cold visitors get no client fetch or flash.
  const seedPrograms: Record<string, Program> = {};
  for (const id of plan.programIds) {
    const program = PROGRAMS[id];
    if (program) seedPrograms[id] = program;
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 lg:px-6 py-4">
      <SharedPlanView
        plan={plan}
        catalog={catalog}
        programOptions={programOptions}
        seedPrograms={seedPrograms}
      />
    </div>
  );
}
