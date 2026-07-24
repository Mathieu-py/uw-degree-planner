"use client";

import { ErrorScreen } from "@/components/states/ErrorScreen";

// Scoped to the (planner) group so the "plan is saved" reassurance only shows
// where it's true; /plan/new and other segments fall through to the root
// boundary's generic copy.
export default function PlannerErrorBoundary({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <ErrorScreen
      kind="500"
      eyebrow="Error 500 · Something went wrong"
      title="That's on us, not you."
      body="We hit an unexpected error loading this page. Your plan is saved — try again in a moment, and if it keeps happening, let us know on GitHub."
      primary={{ label: "Try again", onClick: () => unstable_retry() }}
      secondary={{ label: "Back to the planner", href: "/plan" }}
      reference={error.digest ?? null}
    />
  );
}
