import { PlannerPageContent } from "../page";

export default async function PlanPage(props: {
  params: Promise<{ planId: string }>;
}) {
  const { planId } = await props.params;
  return <PlannerPageContent planId={planId} />;
}
