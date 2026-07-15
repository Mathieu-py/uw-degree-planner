"use client";

import { useState } from "react";
import { FilterSidebar } from "@/components/planner/picker/FilterSidebar";
import {
  PICKER_PAGE_SIZE,
  useFilteredCourses,
} from "@/components/planner/picker/useFilteredCourses";
import { Button } from "@/components/ui/Button";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Input } from "@/components/ui/Input";
import type { SortKey } from "@/lib/courses/courseSort";
import type { Course } from "@/lib/courses/types";
import { pluralize } from "@/lib/format";
import { CourseTable } from "./CourseTable";
import { TermPicker } from "./TermPicker";

// No placed/completed context on the catalog: it's a plan-independent browse
// surface, so eligibility isn't computed (no Status column — that's the picker).
const NO_CODES: Set<string> = new Set();

// Read-only reflection of the active sort in the table toolbar; the sortable
// column headers are the control.
const SORT_LABELS: Record<SortKey, string> = {
  code: "Code",
  name: "Course",
  useful: "Useful",
  easy: "Easy",
  liked: "Liked",
  reviews: "Reviews",
  seats: "Seats",
};

export function CatalogView({ catalog }: { catalog: Course[] }) {
  const {
    filters,
    sortKey,
    sortDir,
    knownPrefixes,
    sorted,
    visible,
    hasMore,
    patchFilters,
    resetFilters,
    onSort,
    showMore,
  } = useFilteredCourses({
    catalog,
    placedCodes: NO_CODES,
    completedBefore: NO_CODES,
  });

  const [addCourse, setAddCourse] = useState<Course | null>(null);

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="flex flex-col gap-1 mb-6">
        <Eyebrow>Course catalog</Eyebrow>
        <h1 className="u-h1">Browse every course</h1>
        <p className="u-body">
          Filter the whole calendar by level, subject, and UWFlow ratings. Add a
          course to a plan and we'll check its prerequisites per term.
        </p>
      </div>

      <div className="flex flex-col md:flex-row gap-6 items-start">
        <div className="w-full md:w-60 shrink-0 card overflow-hidden md:sticky md:top-20 md:max-h-[calc(100vh-6rem)] md:overflow-y-auto">
          <FilterSidebar
            filters={filters}
            knownPrefixes={knownPrefixes}
            onPatch={patchFilters}
            onReset={resetFilters}
            showEligibility={false}
          />
        </div>

        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <Input
            type="search"
            value={filters.query}
            onChange={(e) => patchFilters({ query: e.target.value })}
            aria-label="Search by code or name"
            placeholder="Search by code or name…"
            className="w-full"
          />

          {visible.length === 0 ? (
            <div className="card-2 border border-line rounded-[14px] px-4 py-12 text-center text-sm text-ink-3">
              No matching courses.
            </div>
          ) : (
            <div className="card overflow-hidden flex flex-col">
              <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-line bg-bg-2 text-[12.5px] text-ink-2">
                <span>
                  <b className="text-ink font-semibold">
                    {sorted.length.toLocaleString()}
                  </b>{" "}
                  {pluralize(sorted.length, "course")}
                </span>
                <span>
                  Sort{" "}
                  <b className="text-accent font-semibold">
                    {SORT_LABELS[sortKey]} {sortDir === "asc" ? "↑" : "↓"}
                  </b>
                </span>
              </div>

              <CourseTable
                rows={visible}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
                mode="catalog"
                onAdd={setAddCourse}
              />

              {hasMore ? (
                <div className="border-t border-line px-4 py-3 flex justify-center">
                  <Button variant="outline" onClick={showMore}>
                    Show{" "}
                    {Math.min(PICKER_PAGE_SIZE, sorted.length - visible.length)}{" "}
                    more
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {addCourse ? (
        <TermPicker course={addCourse} onClose={() => setAddCourse(null)} />
      ) : null}
    </div>
  );
}
