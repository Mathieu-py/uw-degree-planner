import { Suspense } from "react";
import { WelcomeFlow } from "@/components/onboarding/WelcomeFlow";
import { getProgramOptions } from "@/lib/programsRegistry";

export const metadata = {
  title: "Create a plan",
};

export default function NewPlanPage() {
  const programOptions = getProgramOptions();
  return (
    <Suspense fallback={null}>
      <WelcomeFlow programOptions={programOptions} />
    </Suspense>
  );
}
