import { DashboardView } from "@/components/dashboard/DashboardView";
import { programNameMap } from "@/lib/programs";

export const metadata = {
  title: "My plans · UW Degree Planner",
};

export default function PlansPage() {
  // Small id→name digest so the client can label cards without shipping the
  // full programs.json.
  return <DashboardView programNames={programNameMap()} />;
}
