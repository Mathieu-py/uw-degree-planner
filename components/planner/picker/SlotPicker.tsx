"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import type { SortDir, SortKey } from "@/lib/courses/courseSort";
import type { EligibilityRow } from "@/lib/courses/eligibility";
import { seatsAvailable } from "@/lib/courses/filters";
import type { Course } from "@/lib/courses/types";
import { formatCourseCode, formatPercent, truncate } from "@/lib/format";
import { useModalExit } from "@/lib/hooks/useModalExit";
import type { EligibilityResult } from "@/lib/prereqs/satisfied";
import {
  PICKER_PAGE_SIZE,
  type PickerFilters,
  useFilteredCourses,
} from "./useFilteredCourses";

interface Props {
  targetTermLabel: string;
  catalog: Course[];
  /** Codes already placed anywhere in the plan — excluded from suggestions. */
  placedCodes: Set<string>;
  /** Completed set as of the target slot's term (used for prereq eval). */
  completedBefore: Set<string>;
  /** Optional restriction to specific codes (e.g. audit drill-in). */
  focusCodes?: string[];
  onPick: (code: string) => void;
  onClose: () => void;
}

const LEVEL_BUCKETS = [100, 200, 300, 400] as const;

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
      <header className="border-b border-zinc-200 dark:border-zinc-800 px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Add a course to
          </div>
          <h2 id="slot-picker-title" className="text-sm font-medium truncate">
            {targetTermLabel}
            {focusCodes && focusCodes.length > 0
              ? " · filtered to requirement options"
              : null}
          </h2>
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
          <div className="border-b border-zinc-200 dark:border-zinc-800 px-4 py-3">
            <input
              type="search"
              value={filters.query}
              onChange={(e) => patchFilters({ query: e.target.value })}
              // biome-ignore lint/a11y/noAutofocus: search is the primary action when the modal opens
              autoFocus
              aria-label="Search by code or name"
              placeholder="Search by code or name…"
              className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-950 dark:focus:ring-zinc-200"
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            {visible.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
                No matching courses.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800">
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
                      <th className="px-2 py-2 text-zinc-500 text-xs font-medium">
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
              <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-800">
                <Button variant="ghost" onClick={showMore}>
                  Show{" "}
                  {Math.min(PICKER_PAGE_SIZE, sorted.length - visible.length)}{" "}
                  more
                </Button>
              </div>
            ) : null}
          </div>
          <footer className="border-t border-zinc-200 dark:border-zinc-800 px-4 py-2 text-xs text-zinc-500 dark:text-zinc-400">
            {sorted.length.toLocaleString()} candidate
            {sorted.length === 1 ? "" : "s"} · click a row to add to the slot
          </footer>
        </div>
      </div>
    </Modal>
  );
}

function FilterSidebar({
  filters,
  knownPrefixes,
  onPatch,
  onReset,
}: {
  filters: PickerFilters;
  knownPrefixes: string[];
  onPatch: (p: Partial<PickerFilters>) => void;
  onReset: () => void;
}) {
  function toggleLevel(lvl: number) {
    const cur = filters.levels;
    const expanded = cur.length === 0 ? [...LEVEL_BUCKETS] : cur;
    const next = expanded.includes(lvl)
      ? expanded.filter((l) => l !== lvl)
      : [...expanded, lvl];
    if (next.length === 0 || next.length === LEVEL_BUCKETS.length) {
      onPatch({ levels: [] });
      return;
    }
    onPatch({ levels: [...next].sort((a, b) => a - b) });
  }

  return (
    <aside className="w-full md:w-60 shrink-0 border-b md:border-b-0 md:border-r border-zinc-200 dark:border-zinc-800 px-4 py-3 flex flex-col gap-4 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Filters
        </h3>
        <Button
          variant="ghost"
          onClick={onReset}
          className="underline-offset-2"
        >
          Reset
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Levels
        </span>
        <div className="flex flex-wrap gap-1.5">
          {LEVEL_BUCKETS.map((lvl) => {
            const active =
              filters.levels.length === 0 || filters.levels.includes(lvl);
            return (
              <button
                key={lvl}
                type="button"
                onClick={() => toggleLevel(lvl)}
                aria-pressed={active}
                className={
                  "rounded-full border px-2.5 py-0.5 text-xs font-medium " +
                  (active
                    ? "border-zinc-950 bg-zinc-950 text-zinc-50 dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-950"
                    : "border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-50")
                }
              >
                {lvl}
              </button>
            );
          })}
        </div>
      </div>

      <PrefixExclude
        knownPrefixes={knownPrefixes}
        excluded={filters.excludePrefixes}
        onChange={(excludePrefixes) => onPatch({ excludePrefixes })}
      />

      <RangeRow
        label="Min usefulness"
        value={filters.minUseful}
        onChange={(minUseful) => onPatch({ minUseful })}
      />
      <RangeRow
        label="Min easiness"
        value={filters.minEasy}
        onChange={(minEasy) => onPatch({ minEasy })}
      />

      <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
        <input
          type="checkbox"
          checked={filters.hasSeatsOnly}
          onChange={(e) => onPatch({ hasSeatsOnly: e.target.checked })}
          className="h-3.5 w-3.5 rounded border-zinc-300 dark:border-zinc-700"
        />
        Has seats only
      </label>
      <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
        <input
          type="checkbox"
          checked={filters.hideUnmetPrereqs}
          onChange={(e) => onPatch({ hideUnmetPrereqs: e.target.checked })}
          className="h-3.5 w-3.5 rounded border-zinc-300 dark:border-zinc-700"
        />
        Hide unmet prereqs
      </label>
    </aside>
  );
}

function PrefixExclude({
  knownPrefixes,
  excluded,
  onChange,
}: {
  knownPrefixes: string[];
  excluded: string[];
  onChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const excludedSet = new Set(excluded);
  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return knownPrefixes;
    return knownPrefixes.filter((p) => p.includes(q));
  }, [knownPrefixes, query]);

  function toggle(p: string) {
    onChange(
      excludedSet.has(p) ? excluded.filter((x) => x !== p) : [...excluded, p],
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        Exclude prefixes
      </span>
      {excluded.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {excluded.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => toggle(p)}
              className="rounded-full bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-200 px-2 py-0.5 text-[10px] font-medium"
              title={`Remove ${p} from excludes`}
            >
              {p} ×
            </button>
          ))}
        </div>
      ) : null}
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter prefixes…"
        className="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1 text-xs placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-950 dark:focus:ring-zinc-200"
      />
      <div className="max-h-32 overflow-y-auto flex flex-wrap gap-1 mt-0.5">
        {filtered.slice(0, 50).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => toggle(p)}
            disabled={excludedSet.has(p)}
            className={
              "rounded border px-1.5 py-0.5 text-[10px] font-medium " +
              (excludedSet.has(p)
                ? "border-zinc-200 dark:border-zinc-800 text-zinc-300 dark:text-zinc-700 cursor-default"
                : "border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-50")
            }
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

function RangeRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const pct = Math.round((value ?? 0) * 100);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[11px] text-zinc-600 dark:text-zinc-400">
        <span>{label}</span>
        <span className="tabular-nums">{pct === 0 ? "off" : `${pct}%`}</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={pct}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(n === 0 ? null : n / 100);
        }}
        className="accent-zinc-950 dark:accent-zinc-50"
      />
    </div>
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
        "px-2 py-2 text-zinc-500 text-xs font-medium " +
        (align === "right" ? "text-right" : "text-left")
      }
    >
      <button
        type="button"
        onClick={() => onSort(col)}
        className={
          "inline-flex items-center gap-1 hover:text-zinc-950 dark:hover:text-zinc-50 " +
          (align === "right" ? "flex-row-reverse" : "")
        }
      >
        {label}
        {active ? (
          <span className="text-zinc-400">{sortDir === "asc" ? "↑" : "↓"}</span>
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
    <tr className="border-b border-zinc-100 dark:border-zinc-900 hover:bg-zinc-50/60 dark:hover:bg-zinc-900/40">
      <td className="px-2 py-2 font-mono text-xs whitespace-nowrap">
        <button
          type="button"
          onClick={onPick}
          className="text-zinc-950 dark:text-zinc-50 hover:underline"
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
          <span className="text-zinc-900 dark:text-zinc-100 line-clamp-2 min-w-0">
            {course.name}
          </span>
          {eligibility ? <EligibilityChip result={eligibility} /> : null}
        </button>
      </td>
      <RatingCell value={course.rating?.useful} />
      <RatingCell value={course.rating?.easy} />
      <RatingCell value={course.rating?.liked} />
      <td className="px-2 py-2 text-right text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
        {reviews}
      </td>
      <td className="px-2 py-2 text-right text-xs tabular-nums">
        {seats == null ? (
          <span className="text-zinc-400">—</span>
        ) : seats > 0 ? (
          <span className="text-emerald-600 dark:text-emerald-400">
            {seats}
          </span>
        ) : (
          <span className="text-zinc-400">0</span>
        )}
      </td>
      <td className="px-2 py-2 text-right">
        <Link
          href={`/course/${course.code}`}
          target="_blank"
          rel="noopener"
          title="Open full course details (new tab)"
          aria-label={`Full details for ${course.code}`}
          className="inline-flex items-center justify-center w-6 h-6 rounded text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-50 hover:bg-zinc-100 dark:hover:bg-zinc-800"
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
    return <td className="px-2 py-2 text-right text-xs text-zinc-400">—</td>;
  }
  const pct = Math.round(value * 100);
  const color =
    pct >= 70 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-rose-500";
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

function EligibilityChip({ result }: { result: EligibilityResult }) {
  if (result.satisfied && !result.uncertain) {
    return (
      <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200 px-1.5 py-0.5 text-[10px] font-medium">
        Eligible
      </span>
    );
  }
  if (result.satisfied && result.uncertain) {
    const hint = result.rawRequirements[0] ?? "manual check";
    return (
      <span
        className="inline-flex shrink-0 items-center rounded-full bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200 px-1.5 py-0.5 text-[10px] font-medium"
        title={result.rawRequirements.join(" · ")}
      >
        Check: {truncate(hint, 18)}
      </span>
    );
  }
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-200 px-1.5 py-0.5 text-[10px] font-medium"
      title={result.missingCourses.map(formatCourseCode).join(", ")}
    >
      Missing prereqs
    </span>
  );
}
