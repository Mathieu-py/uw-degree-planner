"use client";

import type { PureFilters, StudentPassage } from "@/lib/types";
import { FiltersPanel } from "./FiltersPanel";
import { StudentPassagePanel } from "./StudentPassagePanel";

interface Props {
  filters: PureFilters;
  passage: StudentPassage;
  completedCourses: string[];
  onCompletedChange: (next: string[]) => void;
  allCourseCodes: string[];
  knownPrefixes: string[];
}

/**
 * Composer shell. Each child panel owns the patch + commit path for its slice
 * of catalog state (PureFilters / StudentPassage), so a commit on one side
 * never disturbs the other side's URL params.
 */
export function FilterPanel({
  filters,
  passage,
  completedCourses,
  onCompletedChange,
  allCourseCodes,
  knownPrefixes,
}: Props) {
  return (
    <aside className="flex flex-col gap-6 text-sm">
      <FiltersPanel filters={filters} knownPrefixes={knownPrefixes} />
      <StudentPassagePanel
        passage={passage}
        completedCourses={completedCourses}
        onCompletedChange={onCompletedChange}
        allCourseCodes={allCourseCodes}
      />
    </aside>
  );
}
