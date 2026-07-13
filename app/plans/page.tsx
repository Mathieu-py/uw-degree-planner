import { DashboardView } from "@/components/dashboard/DashboardView";
import { programNameMap } from "@/lib/programsRegistry";

export const metadata = {
  title: "My plans",
};

export default function PlansPage() {
  // Small id→name digest so the client can label cards without shipping the
  // full programs.json.
  return <DashboardView programNames={programNameMap()} />;
}
