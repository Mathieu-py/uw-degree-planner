"use client";

import type { LocalPlan } from "@/lib/plan/types";
import { splitProgramName } from "@/lib/programs";

interface Props {
  programName: string;
  planName: string;
  plan: LocalPlan;
}

function streamLabel(stream: LocalPlan["stream"]): string {
  if (stream === "stream4") return "Stream 4 co-op";
  if (stream === "stream8") return "Stream 8 co-op";
  return "Regular (no co-op)";
}

/**
 * Top header of the planner workspace: the program as a mono eyebrow, the plan
 * name as the page heading, and the degree title + stream beneath. Workspace +
 * plan-level actions render in the row below in PlannerShell, not here.
 */
export function ProgramHeader({ programName, planName, plan }: Props) {
  const { title: program, degree } = splitProgramName(programName);
  const stream = streamLabel(plan.stream);
  const parts = degree ? [...degree.split(/\s+-\s+/), stream] : [stream];
  const subtitle = parts.join(" · ");

  return (
    <header className="min-w-0 flex flex-col gap-0.5">
      <span
        className="u-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3 truncate"
        title={programName}
      >
        {program}
      </span>
      <h1
        className="text-2xl font-bold tracking-tight leading-tight truncate"
        title={planName}
      >
        {planName}
      </h1>
      <p className="u-body text-[13px] truncate">{subtitle}</p>
    </header>
  );
}
