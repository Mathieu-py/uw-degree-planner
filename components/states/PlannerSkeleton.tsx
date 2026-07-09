import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Loading placeholder shaped like the loaded planner: a full-width header row,
 * a wrapping grid of term cards (label + a few slot bars each), and the sticky
 * audit panel on the side. Rendered by the planner route's
 * `app/plan/(planner)/loading.tsx` and by PlannerShell's pre-plan branches, so
 * one continuous skeleton persists from route load until the plan renders.
 */
export function PlannerSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      {/* Header row: program eyebrow + plan name vs. import button */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-8 w-56" />
        </div>
        <Skeleton className="h-12 w-44 rounded-[10px]" />
      </div>

      <div className="flex flex-col lg:flex-row gap-5">
        {/* Timeline: 4-per-row term cards */}
        <div className="flex-1 min-w-0 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder
              key={i}
              className="card p-3 flex flex-col gap-2.5 min-h-[148px]"
            >
              <Skeleton className="h-3.5 w-12" />
              <Skeleton className="h-9 w-full rounded-[8px]" />
              <Skeleton className="h-9 w-full rounded-[8px]" />
              <Skeleton className="h-9 w-full rounded-[8px]" />
            </div>
          ))}
        </div>

        {/* Audit panel */}
        <div className="w-full lg:w-80 shrink-0">
          <div className="card p-4 flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-8 w-32" />
              <Skeleton className="h-2 w-full rounded-full" />
            </div>
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder
                key={i}
                className="flex items-center gap-2.5"
              >
                <Skeleton className="h-2.5 w-2.5 rounded-full" />
                <Skeleton className="h-3.5 flex-1" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
