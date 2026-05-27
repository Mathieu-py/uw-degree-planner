"use client";

import type { LocalPlan } from "@/lib/plan/types";

interface Props {
  programName: string;
  plan: LocalPlan;
}

function streamLabel(stream: LocalPlan["stream"]): string {
  if (stream === "stream4") return "Stream 4 co-op";
  if (stream === "stream8") return "Stream 8 co-op";
  return "Regular (no co-op)";
}

// Program names in data/programs.json are "Short Name (Long Degree Title)".
// Split so the short name reads as a page heading and the degree title goes
// in the subtitle; non-parenthesized names fall through unchanged.
function splitProgramName(name: string): [string, string | null] {
  const m = name.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (!m) return [name, null];
  return [m[1], m[2]];
}

/**
 * Top header of the planner workspace: program name as a page heading with
 * the degree title + stream beneath. Workspace + plan-level actions render
 * in the row below in PlannerShell, not here, so this stays a tight headline.
 *
 * Degree titles in the source data follow the pattern
 * "Bachelor of Mathematics - Honours" — we split on " - " so the subtitle
 * reads as bullet-separated parts ("Bachelor of Mathematics · Honours ·
 * Regular") instead of a single hyphenated phrase.
 */
export function ProgramHeader({ programName, plan }: Props) {
  const [title, degree] = splitProgramName(programName);
  const stream = streamLabel(plan.stream);
  const parts = degree ? [...degree.split(/\s+-\s+/), stream] : [stream];
  const subtitle = parts.join(" · ");

  return (
    <header className="min-w-0 flex flex-col gap-1">
      <h1
        className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 truncate"
        title={programName}
      >
        {title}
      </h1>
      <p className="text-base text-zinc-500 dark:text-zinc-400 truncate">
        {subtitle}
      </p>
    </header>
  );
}
