import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { SharedPlanView } from "@/components/planner/viewer/SharedPlanView";
import { loadTerm } from "@/lib/courses/data";
import { loadSharedPlan } from "@/lib/plan/server/actions";
import { getProgramOptions } from "@/lib/programsRegistry";
import { PINNED_TERM } from "@/lib/terms";

// generateMetadata and the page both need the shared plan; React.cache dedups
// the RPC so cold visitors pay one round trip.
const loadSharedPlanCached = cache(loadSharedPlan);

interface PageProps {
  // Next 16: route params are async.
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
  const result = await loadSharedPlanCached(shareToken);
  if (!result.ok || !result.data) notFound();

  // Same tiny digest as /plan, so the shared view loads fast for cold visitors.
  const programOptions = getProgramOptions();

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
