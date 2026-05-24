"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { attachEligibility, type BrowseRow } from "@/lib/browse";
import { applyFilters, seatsAvailable } from "@/lib/filters";
import { formatCourseCode, formatPercent, truncate } from "@/lib/format";
import type { EligibilityResult } from "@/lib/prereqs/satisfied";
import {
  compareCourses,
  DEFAULT_SORT_DIR,
  DEFAULT_SORT_KEY,
  type SortDir,
  type SortKey,
} from "@/lib/sort";
import type { Course } from "@/lib/types";

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
const PAGE = 50;

interface PickerFilters {
  query: string;
  levels: number[];
  excludePrefixes: string[];
  minUseful: number | null;
  minEasy: number | null;
  hasSeatsOnly: boolean;
  hideUnmetPrereqs: boolean;
}

const DEFAULT_FILTERS: PickerFilters = {
  query: "",
  levels: [],
  excludePrefixes: [],
  minUseful: null,
  minEasy: null,
  hasSeatsOnly: false,
  hideUnmetPrereqs: true,
};

/**
 * Modal slot picker. The default view auto-filters the catalog to candidates
 * for the target slot (not placed, prereqs satisfied) and surfaces every
 * UWFlow column in a sortable table. A sidebar of filter controls lets the
 * student adjust levels, exclude prefixes, set rating floors, and toggle
 * seats / prereq hiding.
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
  const [filters, setFilters] = useState<PickerFilters>(DEFAULT_FILTERS);
  const [sortKey, setSortKey] = useState<SortKey>(DEFAULT_SORT_KEY);
  const [sortDir, setSortDir] = useState<SortDir>(DEFAULT_SORT_DIR);
  const [limit, setLimit] = useState(PAGE);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const knownPrefixes = useMemo(
    () => [...new Set(catalog.map((c) => c.prefix))].sort(),
    [catalog],
  );

  // Apply: focus codes → not-placed → user filters → search → eligibility →
  // sort. Each step is pure and memoised against its inputs.
  const candidates = useMemo<Course[]>(() => {
    if (focusCodes && focusCodes.length > 0) {
      const want = new Set(focusCodes.map((c) => c.toLowerCase()));
      return catalog.filter((c) => want.has(c.code) && !placedCodes.has(c.code));
    }
    return catalog.filter((c) => !placedCodes.has(c.code));
  }, [catalog, focusCodes, placedCodes]);

  const userFiltered = useMemo<Course[]>(
    () =>
      applyFilters(candidates, {
        excludePrefixes: filters.excludePrefixes,
        levels: filters.levels,
        hasSeatsAvailable: filters.hasSeatsOnly,
        hideUnmetPrereqs: false, // prereq filtering happens in attachEligibility
        minUseful: filters.minUseful,
        minEasy: filters.minEasy,
      }),
    [candidates, filters],
  );

  const searched = useMemo(() => {
    const q = filters.query.trim().toLowerCase().replace(/\s+/g, "");
    if (!q) return userFiltered;
    return userFiltered.filter(
      (c) =>
        c.code.toLowerCase().replace(/\s+/g, "").includes(q) ||
        c.name.toLowerCase().includes(q),
    );
  }, [userFiltered, filters.query]);

  const completedList = useMemo(() => [...completedBefore], [completedBefore]);

  const annotated = useMemo<BrowseRow[]>(() => {
    const baseRows = searched.map((course) => ({ course, eligibility: null }));
    return attachEligibility(baseRows, completedList, filters.hideUnmetPrereqs);
  }, [searched, completedList, filters.hideUnmetPrereqs]);

  const sorted = useMemo(
    () =>
      [...annotated].sort((a, b) =>
        compareCourses(a.course, b.course, sortKey, sortDir),
      ),
    [annotated, sortKey, sortDir],
  );

  const visible = sorted.slice(0, limit);
  const hasMore = sorted.length > limit;

  function patchFilters(p: Partial<PickerFilters>) {
    setFilters((prev) => ({ ...prev, ...p }));
    setLimit(PAGE);
  }

  function resetFilters() {
    setFilters(DEFAULT_FILTERS);
    setSortKey(DEFAULT_SORT_KEY);
    setSortDir(DEFAULT_SORT_DIR);
    setLimit(PAGE);
  }

  function onSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "code" || key === "name" ? "asc" : "desc");
    }
    setLimit(PAGE);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="slot-picker-title"
        className="relative bg-white dark:bg-zinc-950 rounded-lg shadow-2xl max-w-5xl w-full max-h-[90vh] flex flex-col overflow-hidden border border-zinc-200 dark:border-zinc-800"
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
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-zinc-500 hover:text-zinc-950 hover:bg-zinc-100 dark:hover:text-zinc-50 dark:hover:bg-zinc-800"
          >
            <span aria-hidden="true">×</span>
          </button>
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
                        onPick={() => onPick(r.course.code)}
                      />
                    ))}
                  </tbody>
                </table>
              )}
              {hasMore ? (
                <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setLimit((n) => n + PAGE)}
                    className="text-xs text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-50 underline-offset-4 hover:underline"
                  >
                    Show {Math.min(PAGE, sorted.length - limit)} more
                  </button>
                </div>
              ) : null}
            </div>
            <footer className="border-t border-zinc-200 dark:border-zinc-800 px-4 py-2 text-xs text-zinc-500 dark:text-zinc-400">
              {sorted.length.toLocaleString()} candidate
              {sorted.length === 1 ? "" : "s"} · click a row to add to the slot
            </footer>
          </div>
        </div>
      </div>
    </div>
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
        <button
          type="button"
          onClick={onReset}
          className="text-xs text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50 underline-offset-2 hover:underline"
        >
          Reset
        </button>
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

function Row({ row, onPick }: { row: BrowseRow; onPick: () => void }) {
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
