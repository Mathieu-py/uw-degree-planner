"use client";

import Link from "next/link";

export default function PlannerErrorBoundary({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28 flex flex-col gap-8">
      <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-900/40 px-6 py-8 flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Something went wrong</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-xl">
          The planner hit an unexpected error. Your saved plan is still in your
          browser — refreshing or returning home is safe.
        </p>
        {error.digest && (
          <p className="text-xs font-mono text-zinc-500 dark:text-zinc-500">
            Reference: {error.digest}
          </p>
        )}
        <div className="flex flex-wrap gap-3 pt-1">
          <button
            type="button"
            onClick={() => unstable_retry()}
            className="rounded bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900 text-sm font-medium px-4 py-2"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded border border-zinc-300 dark:border-zinc-700 text-sm font-medium px-4 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
