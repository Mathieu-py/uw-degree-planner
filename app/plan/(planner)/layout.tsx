// Route group for the planner proper — `/plan` and `/plan/[planId]`. The group
// folder `(planner)` is URL-invisible, so the paths are unchanged; it exists to
// scope this layout to the two timeline routes and exclude `/plan/new` (the
// create stepper), which wants neither this container nor this title.
//
// The wrapper persists across `/plan` ↔ `/plan/[planId]` without remounting,
// and the shared title lives here once (metadata isn't inherited across sibling
// pages).
export const metadata = {
  title: "Plan your degree",
};

// Shared so app/plan/loading.tsx — which sits above this layout and can't
// inherit it — renders the skeleton in the identical container (no drift).
export const PLANNER_CONTAINER_CLASS =
  "mx-auto w-full max-w-screen-2xl px-6 sm:px-8 lg:px-12 py-4 lg:pb-0 flex flex-col gap-3 lg:h-[calc(100dvh-7rem)] lg:overflow-hidden";

export default function PlannerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className={PLANNER_CONTAINER_CLASS}>{children}</div>;
}
