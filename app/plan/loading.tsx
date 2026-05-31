import { PlannerSkeleton } from "@/components/states/PlannerSkeleton";

export default function PlanLoading() {
  return (
    <div className="mx-auto w-full max-w-screen-2xl px-6 sm:px-8 lg:px-12 py-4">
      <PlannerSkeleton />
    </div>
  );
}
