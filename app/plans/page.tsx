import { DashboardView } from "@/components/dashboard/DashboardView";
import { PROGRAMS } from "@/lib/programs";

export const metadata = {
  title: "My plans · UW Degree Planner",
};

export default function PlansPage() {
  // Small id→name digest so the client can label cards without shipping the
  // full programs.json.
  const programNames: Record<string, string> = Object.fromEntries(
    Object.entries(PROGRAMS).map(([id, p]) => [id, p.name]),
  );
  return <DashboardView programNames={programNames} />;
}
