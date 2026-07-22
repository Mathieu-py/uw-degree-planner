import { DashboardView } from "@/components/dashboard/DashboardView";
import { DashboardSkeleton } from "@/components/states/PageSkeleton";
import { AuthGate } from "@/lib/auth/store";
import { programNameMap } from "@/lib/programs/registry";

export const metadata = {
  title: "My plans",
};

export default function PlansPage() {
  // Small id→name digest so the client can label cards without shipping the
  // full programs.json.
  return (
    <AuthGate fallback={<DashboardSkeleton />}>
      <DashboardView programNames={programNameMap()} />
    </AuthGate>
  );
}
