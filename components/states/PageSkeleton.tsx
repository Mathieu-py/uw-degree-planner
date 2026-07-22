import { Skeleton } from "@/components/ui/Skeleton";

// Auth-gate fallbacks for the plans and settings pages. Each mirrors its
// view's section/container wrapper so the fallback→view swap doesn't jump.

export function DashboardSkeleton() {
  return (
    <div className="section">
      <div className="container-lg flex flex-col gap-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}

export function SettingsSkeleton() {
  return (
    <div className="section">
      <div className="container-sm flex flex-col gap-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}
