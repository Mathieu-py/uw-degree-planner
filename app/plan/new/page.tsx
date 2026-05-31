import { Suspense } from "react";
import { WelcomeFlow } from "@/components/onboarding/WelcomeFlow";
import { PROGRAMS } from "@/lib/programs";

export const metadata = {
  title: "Create a plan · UW Degree Planner",
};

export default function NewPlanPage() {
  const programOptions = Object.entries(PROGRAMS)
    .map(([id, p]) => ({ id, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Suspense fallback={null}>
      <WelcomeFlow programOptions={programOptions} />
    </Suspense>
  );
}
