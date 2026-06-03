"use client";

import Link from "next/link";
import { useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import type { CourseEligibilityVerdict } from "@/lib/courses/courseEligibility";
import type { SortDir, SortKey } from "@/lib/courses/courseSort";
import type { EligibilityRow } from "@/lib/courses/eligibility";
import { seatsAvailable } from "@/lib/courses/filters";
import { getRatingColor } from "@/lib/courses/ratingColor";
import type { Course } from "@/lib/courses/types";
import { formatCourseCode, formatPercent, truncate } from "@/lib/format";
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
  /** Student's program so program-restriction prereqs resolve instead of "check". */
  program?: ProgramIdentity;
  /** Codes the student's program references (suppresses stale program blocks). */
  programReferenced?: ReadonlySet<string>;
  /** Codes already in the target slot (lets coreqs resolve same-term). */
  sameTerm?: ReadonlySet<string>;
  /** Optional restriction to specific codes (e.g. audit drill-in). */
  focusCodes?: string[];
  onPick: (code: string) => void;
  onClose: () => void;
}

/**
 * Modal slot picker. Filter+sort+paginate pipeline lives in
 * {@link useFilteredCourses}; this component owns layout, focus handling,
 * and the table presentation.
 */
export function SlotPicker({
  targetTermLabel,
  catalog,
  placedCodes,
  completedBefore,
  level,
  program,
  programReferenced,
  sameTerm,
  focusCodes,
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
    program,
    programReferenced,
    sameTerm,
    focusCodes,
  });

  // Row clicks forward the picked code AFTER the exit animation. animateOut
  // returns once EXIT_MS has elapsed (or immediately if a close was already
  // in flight), so pick-during-close and rapid double-pick are deduped.
  const handlePick = useCallback(
    async (code: string) => {
      await animateOut();
      onPick(code);
    },
    [animateOut, onPick],
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
            <input
              type="search"
              value={filters.query}
              onChange={(e) => patchFilters({ query: e.target.value })}
              // biome-ignore lint/a11y/noAutofocus: search is the primary action when the modal opens
              autoFocus
              aria-label="Search by code or name"
              placeholder="Search by code or name…"
              className="w-full rounded-md border border-line-2 bg-bg px-3 py-2 text-sm placeholder:text-ink-3 outline-none focus:border-accent-bg focus:shadow-[0_0_0_3px_var(--accent-soft)]"
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            {visible.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-ink-3">
                No matching courses.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-bg border-b border-line">
                    <tr className="text-left">
                      <Th
                        label="Code"
                        col="code"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        onSort={onSort}
                      />
                      <Th
                        label="Course"
                        col="name"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        onSort={onSort}
                      />
                      <Th
                        label="Useful"
                        col="useful"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        onSort={onSort}
                        align="right"
                      />
                      <Th
                        label="Easy"
                        col="easy"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        onSort={onSort}
                        align="right"
                      />
                      <Th
                        label="Liked"
                        col="liked"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        onSort={onSort}
                        align="right"
                      />
                      <Th
                        label="Rev."
                        col="reviews"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        onSort={onSort}
                        align="right"
                      />
                      <Th
                        label="Seats"
                        col="seats"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        onSort={onSort}
                        align="right"
                      />
                      <th className="px-2 py-2 text-ink-3 text-xs font-medium">
                        {/* details link column */}
                        <span className="sr-only">Details</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r) => (
                      <Row
                        key={r.course.id}
                        row={r}
                        onPick={() => handlePick(r.course.code)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
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
            {sorted.length.toLocaleString()} candidate
            {sorted.length === 1 ? "" : "s"} · click a row to add to the slot
          </footer>
        </div>
      </div>
    </Modal>
  );
}

function Th({
  label,
  col,
  sortKey,
  sortDir,
  onSort,
  align = "left",
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = col === sortKey;
  return (
    <th
      className={
        "px-2 py-2 text-ink-3 text-xs font-medium " +
        (align === "right" ? "text-right" : "text-left")
      }
    >
      <button
        type="button"
        onClick={() => onSort(col)}
        className={
          "inline-flex items-center gap-1 hover:text-ink " +
          (align === "right" ? "flex-row-reverse" : "")
        }
      >
        {label}
        {active ? (
          <span className="text-ink-3">{sortDir === "asc" ? "↑" : "↓"}</span>
        ) : null}
      </button>
    </th>
  );
}

function Row({ row, onPick }: { row: EligibilityRow; onPick: () => void }) {
  const { course, eligibility } = row;
  const reviews = course.rating?.filled_count ?? 0;
  const seats = seatsAvailable(course);
  return (
    <tr className="border-b border-line hover:bg-bg-2">
      <td className="px-2 py-2 font-mono text-xs whitespace-nowrap">
        <button
          type="button"
          onClick={onPick}
          className="text-ink hover:underline"
        >
          {formatCourseCode(course.code)}
        </button>
      </td>
      <td className="px-2 py-2">
        <button
          type="button"
          onClick={onPick}
          className="text-left flex items-center gap-2 min-w-0 w-full"
        >
          <span className="text-ink line-clamp-2 min-w-0">{course.name}</span>
          {eligibility ? <EligibilityChip verdict={eligibility} /> : null}
        </button>
      </td>
      <RatingCell value={course.rating?.useful} />
      <RatingCell value={course.rating?.easy} />
      <RatingCell value={course.rating?.liked} />
      <td className="px-2 py-2 text-right text-xs tabular-nums text-ink-2">
        {reviews}
      </td>
      <td className="px-2 py-2 text-right text-xs tabular-nums">
        {seats == null ? (
          <span className="text-ink-3">—</span>
        ) : seats > 0 ? (
          <span className="text-met">{seats}</span>
        ) : (
          <span className="text-ink-3">0</span>
        )}
      </td>
      <td className="px-2 py-2 text-right">
        <Link
          href={`/course/${course.code}`}
          target="_blank"
          rel="noopener"
          title="Open full course details (new tab)"
          aria-label={`Full details for ${course.code}`}
          className="inline-flex items-center justify-center w-6 h-6 rounded text-ink-3 hover:text-ink hover:bg-bg-2"
          onClick={(e) => e.stopPropagation()}
        >
          <span aria-hidden="true">↗</span>
        </Link>
      </td>
    </tr>
  );
}

function RatingCell({ value }: { value: number | null | undefined }) {
  if (value == null) {
    return <td className="px-2 py-2 text-right text-xs text-ink-3">—</td>;
  }
  const color = getRatingColor(value);
  return (
    <td className="px-2 py-2 text-right">
      <div className="inline-flex items-center gap-1.5 justify-end min-w-[56px]">
        <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
        <span className="tabular-nums text-xs font-medium w-9 text-right">
          {formatPercent(value)}
        </span>
      </div>
    </td>
  );
}

function EligibilityChip({ verdict }: { verdict: CourseEligibilityVerdict }) {
  if (verdict.state === "eligible") {
    return (
      <span className="inline-flex shrink-0 items-center rounded-full bg-met-soft text-met px-1.5 py-0.5 text-[10px] font-medium">
        Eligible
      </span>
    );
  }
  if (verdict.state === "check") {
    const hint = verdict.reasons[0] ?? "manual check";
    return (
      <span
        className="inline-flex shrink-0 items-center rounded-full bg-partial-soft text-partial px-1.5 py-0.5 text-[10px] font-medium"
        title={verdict.reasons.join(" · ")}
      >
        Check: {truncate(hint, 18)}
      </span>
    );
  }
  // Ineligible — label the specific reason rather than a bare "missing prereqs".
  // (A picker row is never `alreadyPlaced`: candidates are pre-filtered by the
  // placed set in useFilteredCourses, so that verdict can't reach here.)
  if (verdict.antireqConflicts.length > 0) {
    return (
      <span
        className="inline-flex shrink-0 items-center rounded-full bg-danger-soft text-danger px-1.5 py-0.5 text-[10px] font-medium"
        title={`Antireq conflict: ${verdict.antireqConflicts.join(", ")}`}
      >
        Antireq conflict
      </span>
    );
  }
  if (verdict.blockedByProgram) {
    return (
      <span
        className="inline-flex shrink-0 items-center rounded-full bg-danger-soft text-danger px-1.5 py-0.5 text-[10px] font-medium"
        title={verdict.rawRequirements.join(" · ")}
      >
        Wrong program
      </span>
    );
  }
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full bg-danger-soft text-danger px-1.5 py-0.5 text-[10px] font-medium"
      title={
        verdict.missingCourses.length > 0
          ? verdict.missingCourses.map(formatCourseCode).join(", ")
          : verdict.rawRequirements.join(" · ")
      }
    >
      Missing prereqs
    </span>
  );
}
