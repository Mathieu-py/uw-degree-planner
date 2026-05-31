import { Skeleton } from "@/components/ui/Skeleton";

export default function CourseLoading() {
  return (
    <div className="mx-auto max-w-5xl w-full px-6 py-10" aria-hidden="true">
      <Skeleton className="h-3 w-32" />
      <div className="mt-4 flex flex-col gap-2">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-5 w-80 max-w-full" />
      </div>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-8 items-start">
        {/* Main column: description + meta cards + sections */}
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder
                key={i}
                className="h-24 w-full rounded-[14px]"
              />
            ))}
          </div>
          <Skeleton className="h-40 w-full rounded-[14px]" />
        </div>

        {/* Sticky add rail */}
        <aside className="card p-5 flex flex-col gap-5">
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder
                key={i}
                className="flex flex-col gap-1.5 items-center"
              >
                <Skeleton className="h-7 w-10" />
                <Skeleton className="h-3 w-12" />
              </div>
            ))}
          </div>
          <Skeleton className="h-[42px] w-full rounded-[9px]" />
          <Skeleton className="h-[42px] w-full rounded-[9px]" />
        </aside>
      </div>
    </div>
  );
}
