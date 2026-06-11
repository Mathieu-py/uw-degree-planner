"use client";

import Link from "next/link";
import { useState } from "react";
import { FilterSidebar } from "@/components/planner/picker/FilterSidebar";
import {
  PICKER_PAGE_SIZE,
  useFilteredCourses,
} from "@/components/planner/picker/useFilteredCourses";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { Picker } from "@/components/ui/Picker";
import type { SortKey } from "@/lib/courses/courseSort";
import { seatsAvailable } from "@/lib/courses/filters";
import { getRatingColor } from "@/lib/courses/ratingColor";
import type { Course } from "@/lib/courses/types";
import { formatCourseCode, formatPercent, pluralize } from "@/lib/format";
import { TermPicker } from "./TermPicker";

// No placed/completed context on the catalog: it's a plan-independent browse
// surface, so eligibility isn't computed (rows show prerequisites instead).
const NO_CODES: Set<string> = new Set();

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "code", label: "Code" },
  { key: "useful", label: "Most useful" },
  { key: "easy", label: "Easiest" },
  { key: "liked", label: "Most liked" },
];

export function CatalogView({ catalog }: { catalog: Course[] }) {
  const {
    filters,
    sortKey,
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
            showHideUnmet={false}
          />
        </div>

        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Input
              type="search"
              value={filters.query}
              onChange={(e) => patchFilters({ query: e.target.value })}
              aria-label="Search by code or name"
              placeholder="Search by code or name…"
              className="flex-1"
            />
            <Picker
              value={sortKey}
              onChange={onSort}
              options={SORTS.map((s) => ({ value: s.key, label: s.label }))}
              ariaLabel="Sort courses"
              className="w-44"
            />
          </div>

          <p className="u-small">
            {sorted.length.toLocaleString()}{" "}
            {pluralize(sorted.length, "course")}
          </p>

          {visible.length === 0 ? (
            <div className="card-2 border border-line rounded-[14px] px-4 py-12 text-center text-sm text-ink-3">
              No matching courses.
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {visible.map((r) => (
                <CatalogRow
                  key={r.course.id}
                  course={r.course}
                  onAdd={() => setAddCourse(r.course)}
                />
              ))}
            </ul>
          )}

          {hasMore ? (
            <Button
              variant="outline"
              onClick={showMore}
              className="self-center mt-1"
            >
              Show {Math.min(PICKER_PAGE_SIZE, sorted.length - visible.length)}{" "}
              more
            </Button>
          ) : null}
        </div>
      </div>

      {addCourse ? (
        <TermPicker course={addCourse} onClose={() => setAddCourse(null)} />
      ) : null}
    </div>
  );
}

function CatalogRow({ course, onAdd }: { course: Course; onAdd: () => void }) {
  const seats = seatsAvailable(course);
  const prereqLine = course.prereqs?.trim() || null;

  return (
    <li className="card p-3 flex items-center gap-4">
      <div className="min-w-0 flex-1 flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <Link
            href={`/course/${course.code}?from=catalog`}
            className="u-mono text-[13px] font-bold hover:text-accent"
          >
            {formatCourseCode(course.code)}
          </Link>
          <span className="text-sm text-ink truncate">{course.name}</span>
        </div>
        {prereqLine ? (
          <span className="u-small truncate" title={prereqLine}>
            Prereq: {prereqLine}
          </span>
        ) : (
          <span className="u-small text-ink-3">No prerequisites</span>
        )}
      </div>

      <div className="hidden sm:flex items-center gap-4 shrink-0">
        <MiniRating label="Useful" value={course.rating?.useful} />
        <MiniRating label="Liked" value={course.rating?.liked} />
        {seats != null ? (
          <Chip variant={seats > 0 ? "done" : "default"}>
            {seats > 0 ? `${seats} seats` : "Full"}
          </Chip>
        ) : null}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <Link
          href={`/course/${course.code}?from=catalog`}
          className="inline-flex items-center justify-center w-8 h-8 rounded-[7px] text-ink-3 hover:text-ink hover:bg-bg-2"
          aria-label={`Details for ${course.code}`}
          title="Course details"
        >
          <Icon name="external" size="sm" aria-hidden="true" />
        </Link>
        <Button variant="primary" size="sm" onClick={onAdd}>
          Add
        </Button>
      </div>
    </li>
  );
}

function MiniRating({
  label,
  value,
}: {
  label: string;
  value: number | null | undefined;
}) {
  const pct = value == null ? null : Math.round(value * 100);
  const color = getRatingColor(value);
  return (
    <span
      className="inline-flex items-center gap-1.5 w-[88px]"
      title={`${label}: ${pct == null ? "no data" : `${pct}%`}`}
    >
      <span className="u-small w-10">{label}</span>
      <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
      <span className="u-mono text-[11px] tabular-nums">
        {value == null ? "—" : formatPercent(value)}
      </span>
    </span>
  );
}
