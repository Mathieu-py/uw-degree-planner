"use client";

import { useCallback } from "react";
import { CourseTable } from "@/components/courses/CourseTable";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { isProgramBlocked } from "@/lib/courses/courseEligibility";
import type { Course, FilterPreset } from "@/lib/courses/types";
import { pluralize } from "@/lib/format";
import { useModalExit } from "@/lib/hooks/useModalExit";
import type { ProgramIdentity } from "@/lib/programs";
import { FilterSidebar } from "./FilterSidebar";
import { PICKER_PAGE_SIZE, useFilteredCourses } from "./useFilteredCourses";

interface Props {
  targetTermLabel: string;
  catalog: Course[];
  /** Codes already placed anywhere in the plan — excluded from suggestions. */
  placedCodes: Set<string>;
  /** Completed set as of the target slot's term (used for prereq eval). */
  completedBefore: Set<string>;
  /** Target term's level (e.g. "2A") so level-gated prereqs resolve instead of showing "check". */
  level?: string;
  /** Student's program(s) so program-restriction prereqs resolve instead of "check". */
  programs?: ProgramIdentity[];
  /** Codes the student's program references (suppresses stale program blocks). */
  programReferenced?: ReadonlySet<string>;
  /** Codes already in the target slot (lets coreqs resolve same-term). */
  sameTerm?: ReadonlySet<string>;
  /** Optional restriction to specific codes (e.g. audit drill-in). */
  focusCodes?: string[];
  /** Filters to pre-apply on open (e.g. a subject-pool Browse → its subjects). */
  initialFilters?: FilterPreset;
  onPick: (code: string) => void;
  onClose: () => void;
}

/**
 * Modal slot picker. Filter+sort+paginate pipeline lives in
 * {@link useFilteredCourses}; the table presentation is the shared
 * {@link CourseTable} in picker mode. This component owns modal layout, focus
 * handling, and the add gate.
 */
export function SlotPicker({
  targetTermLabel,
  catalog,
  placedCodes,
  completedBefore,
  level,
  programs,
  programReferenced,
  sameTerm,
  focusCodes,
  initialFilters,
  onPick,
  onClose,
}: Props) {
  const { isClosing, handleClose, animateOut } = useModalExit(onClose);
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
    placedCodes,
    completedBefore,
    level,
    programs,
    programReferenced,
    sameTerm,
    focusCodes,
    initialFilters,
  });

  // Row clicks forward the picked code AFTER the exit animation. animateOut
  // returns once EXIT_MS has elapsed (or immediately if a close was already
  // in flight), so pick-during-close and rapid double-pick are deduped.
  const handlePick = useCallback(
    async (course: Course) => {
      // Hard gate: a course closed to the student's faculty/program can never
      // be added (rows are also rendered non-interactive). Belt-and-suspenders
      // so no add path slips a wrong-faculty course into the plan.
      if (isProgramBlocked(course, { programs, programReferenced })) {
        return;
      }
      await animateOut();
      onPick(course.code);
    },
    [animateOut, onPick, programs, programReferenced],
  );

  return (
    <Modal
      isClosing={isClosing}
      onClose={handleClose}
      titleId="slot-picker-title"
      // The search input inside autoFocuses on mount; keeping the backdrop
      // out of tab order ensures the first Tab moves within the table, not
      // back to the invisible close button.
      backdropTabIndex={-1}
      className="max-w-none sm:max-w-5xl h-full sm:h-auto sm:max-h-[90vh] rounded-none! sm:rounded-lg!"
    >
      <header className="border-b border-line px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0 flex items-center gap-3">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wider text-ink-3">
              Add a course to
            </div>
            <h2 id="slot-picker-title" className="text-sm font-medium truncate">
              {targetTermLabel}
            </h2>
          </div>
          {focusCodes && focusCodes.length > 0 ? (
            <Chip variant="gold">Requirement options</Chip>
          ) : null}
        </div>
        <Button variant="icon" onClick={handleClose} aria-label="Close">
          <Icon name="close" size="md" aria-hidden="true" />
        </Button>
      </header>

      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        <FilterSidebar
          filters={filters}
          knownPrefixes={knownPrefixes}
          onPatch={patchFilters}
          onReset={resetFilters}
        />
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="border-b border-line px-4 py-3">
            <Input
              type="search"
              value={filters.query}
              onChange={(e) => patchFilters({ query: e.target.value })}
              autoFocus
              aria-label="Search by code or name"
              placeholder="Search by code or name…"
            />
          </div>
          {/* overflow-x-hidden: the shared table is fixed-layout + full-width,
              so it never needs horizontal scroll — clip rather than let a
              stray cell spill promote overflow-y:auto's x-axis to a scrollbar. */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            {visible.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-ink-3">
                No matching courses.
              </div>
            ) : (
              <CourseTable
                rows={visible}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
                mode="picker"
                onAdd={handlePick}
              />
            )}
            {hasMore ? (
              <div className="px-4 py-3 border-t border-line">
                <Button variant="ghost" onClick={showMore}>
                  Show{" "}
                  {Math.min(PICKER_PAGE_SIZE, sorted.length - visible.length)}{" "}
                  more
                </Button>
              </div>
            ) : null}
          </div>
          <footer className="border-t border-line px-4 py-2 text-xs text-ink-3">
            {sorted.length.toLocaleString()}{" "}
            {pluralize(sorted.length, "candidate")} · click a row to add to the
            slot
          </footer>
        </div>
      </div>
    </Modal>
  );
}
