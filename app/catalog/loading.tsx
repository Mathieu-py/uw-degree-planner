import { Skeleton } from "@/components/ui/Skeleton";

export default function CatalogLoading() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10" aria-hidden="true">
      <div className="flex flex-col gap-2 mb-6">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      <div className="flex flex-col md:flex-row gap-6 items-start">
        {/* Filter sidebar */}
        <div className="w-full md:w-60 shrink-0 card p-4 flex flex-col gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder
              key={i}
              className="flex flex-col gap-2"
            >
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-8 w-full rounded-[8px]" />
            </div>
          ))}
        </div>

        {/* Results */}
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-[42px] flex-1 rounded-[9px]" />
            <Skeleton className="h-[42px] w-32 rounded-[9px]" />
          </div>
          <Skeleton className="h-3 w-40" />
          <ul className="flex flex-col gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder
                key={i}
                className="card p-3 flex items-center gap-4"
              >
                <div className="min-w-0 flex-1 flex flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-64 max-w-full" />
                  <Skeleton className="h-3 w-40" />
                </div>
                <Skeleton className="h-8 w-16 rounded-[8px]" />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
