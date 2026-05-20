"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { FilterPanel } from "./FilterPanel";
import { Pagination } from "./Pagination";
import { attachEligibility, type BrowseRow } from "@/lib/browse";
import { loadCompletedCourses, saveCompletedCourses } from "@/lib/completedCourses";
import { seatsAvailable } from "@/lib/filters";
import { BROWSE_QS_STORAGE_KEY } from "@/lib/filterState";
import { formatCourseCode, formatPercent, truncate } from "@/lib/format";
import type { EligibilityResult } from "@/lib/prereqs/satisfied";
import {
  DEFAULT_SORT_DIR,
  DEFAULT_SORT_KEY,
  PAGE_SIZE,
  type SortDir,
  type SortKey,
} from "@/lib/sort";
import { safeGetItem, safeRemoveItem, safeSetItem } from "@/lib/storage";
import type { FilterState } from "@/lib/types";

interface Props {
  rows: BrowseRow[];
  state: FilterState;
  sortKey: SortKey;
  sortDir: SortDir;
  page: number;
  totalCount: number;
  allCourseCodes: string[];
  knownPrefixes: string[];
}

export function CourseBrowser({
  rows,
  state,
  sortKey,
  sortDir,
  page,
  totalCount,
  allCourseCodes,
  knownPrefixes,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [completedCourses, setCompletedCourses] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage exactly once on mount. The server-rendered HTML
  // assumes completedCourses=[] (it's not on the URL); we layer the user's
  // profile in here.
  useEffect(() => {
    setCompletedCourses(loadCompletedCourses());
    setHydrated(true);
  }, []);

  // Persist edits. Gated on `hydrated` so the initial [] state doesn't
  // overwrite a stored list before the read completes.
  useEffect(() => {
    if (!hydrated) return;
    saveCompletedCourses(completedCourses);
  }, [hydrated, completedCourses]);

  // Re-derive eligibility client-side once a non-empty completed list arrives.
  // Empty list short-circuits, so this is effectively a no-op on first paint.
  const effectiveRows = useMemo(
    () => attachEligibility(rows, completedCourses, state.hideUnmetPrereqs),
    [rows, completedCourses, state.hideUnmetPrereqs],
  );

  const searched = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/\s+/g, "");
    if (q.length === 0) return effectiveRows;
    return effectiveRows.filter(
      (r) =>
        r.course.code.toLowerCase().replace(/\s+/g, "").includes(q) ||
        r.course.name.toLowerCase().includes(q),
    );
  }, [effectiveRows, query]);

  const isSearching = query.trim().length > 0;

  const totalPages = Math.max(1, Math.ceil(searched.length / PAGE_SIZE));
  const displayPage = Math.min(Math.max(1, page), totalPages);
  const startIdx = (displayPage - 1) * PAGE_SIZE;
  const pageRows = searched.slice(startIdx, startIdx + PAGE_SIZE);

  function setPageInUrl(n: number) {
    const params = new URLSearchParams(window.location.search);
    if (n <= 1) params.delete("p");
    else params.set("p", String(n));
    const qs = params.toString();
    safeSetItem(BROWSE_QS_STORAGE_KEY, qs);
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function setPresentation(next: { s?: SortKey; d?: SortDir }) {
    const params = new URLSearchParams(window.location.search);
    const nextKey = next.s ?? sortKey;
    const nextDir = next.d ?? sortDir;

    if (nextKey === DEFAULT_SORT_KEY) params.delete("s");
    else params.set("s", nextKey);

    if (nextDir === DEFAULT_SORT_DIR) params.delete("d");
    else params.set("d", nextDir);

    params.delete("p");

    const qs = params.toString();
    safeSetItem(BROWSE_QS_STORAGE_KEY, qs);
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function onSort(key: SortKey) {
    if (key === sortKey) {
      setPresentation({ d: sortDir === "asc" ? "desc" : "asc" });
    } else {
      setPresentation({ s: key, d: key === "code" || key === "name" ? "asc" : "desc" });
    }
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <div className="lg:w-72 lg:shrink-0 lg:sticky lg:top-6 lg:self-start">
        <FilterPanel
          state={state}
          completedCourses={completedCourses}
          onCompletedChange={setCompletedCourses}
          allCourseCodes={allCourseCodes}
          knownPrefixes={knownPrefixes}
        />
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <RestorePill />

        <div className="flex flex-wrap items-center gap-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by code or name…"
            className="flex-1 min-w-0 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-950 dark:focus:ring-zinc-200"
          />
        </div>

        <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
          <span>
            {isSearching
              ? `${searched.length.toLocaleString()} of ${effectiveRows.length.toLocaleString()} matches`
              : `${effectiveRows.length.toLocaleString()} of ${totalCount.toLocaleString()} courses`}
          </span>
        </div>

        <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="w-24" />
              <col />
              <col className="w-24" />
              <col className="w-24" />
              <col className="w-24" />
              <col className="w-20" />
              <col className="w-24" />
            </colgroup>
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 text-left">
                <Th label="Code" col="code" current={sortKey} dir={sortDir} onSort={onSort} />
                <Th label="Course" col="name" current={sortKey} dir={sortDir} onSort={onSort} />
                <Th label="Useful" col="useful" current={sortKey} dir={sortDir} onSort={onSort} align="right" />
                <Th label="Easy" col="easy" current={sortKey} dir={sortDir} onSort={onSort} align="right" />
                <Th label="Liked" col="liked" current={sortKey} dir={sortDir} onSort={onSort} align="right" />
                <Th label="Reviews" col="reviews" current={sortKey} dir={sortDir} onSort={onSort} align="right" />
                <Th label="Seats" col="seats" current={sortKey} dir={sortDir} onSort={onSort} align="right" />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <CourseRow key={r.course.id} row={r} />
              ))}
              {searched.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400"
                  >
                    No courses match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <Pagination
            page={displayPage}
            totalPages={totalPages}
            onChange={setPageInUrl}
          />
        )}
      </div>
    </div>
  );
}

function RestorePill() {
  const router = useRouter();
  const pathname = usePathname();
  const [savedQuery, setSavedQuery] = useState<string | null>(null);

  // FilterPanel.commit + setPresentation own the live save path. This effect
  // covers two mount-only cases: (a) URL has params (e.g. shared link) →
  // seed localStorage so the next zero-param visit can offer to restore;
  // (b) URL is empty → check if there's anything to offer.
  useEffect(() => {
    const currentSearch = window.location.search;
    if (currentSearch === "") {
      const saved = safeGetItem(BROWSE_QS_STORAGE_KEY);
      if (saved && saved !== "") {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is unavailable during SSR; this is a one-time mount-only hydration read.
        setSavedQuery(saved);
      }
    } else {
      safeSetItem(BROWSE_QS_STORAGE_KEY, currentSearch.replace(/^\?/, ""));
    }
  }, []);

  if (!savedQuery) return null;
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 px-3 py-2 text-xs">
      <span className="text-zinc-600 dark:text-zinc-400">
        You have saved filters from a previous visit.
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            router.replace(`${pathname}?${savedQuery}`, { scroll: false });
            setSavedQuery(null);
          }}
          className="rounded bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950 px-2 py-1 font-medium"
        >
          Restore
        </button>
        <button
          type="button"
          onClick={() => {
            safeRemoveItem(BROWSE_QS_STORAGE_KEY);
            setSavedQuery(null);
          }}
          className="rounded text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50 px-2 py-1"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

function CourseRow({ row }: { row: BrowseRow }) {
  const { course, eligibility } = row;
  const reviews = course.rating?.filled_count ?? 0;
  const seats = seatsAvailable(course);
  return (
    <tr className="relative border-b last:border-0 border-zinc-100 dark:border-zinc-900 hover:bg-zinc-50/60 dark:hover:bg-zinc-900/30 transition-colors">
      <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
        <Link
          href={`/course/${course.code}`}
          tabIndex={-1}
          className="absolute inset-0"
        >
          <span className="sr-only">View {formatCourseCode(course.code)}</span>
        </Link>
        <Link
          href={`/course/${course.code}`}
          className="relative text-zinc-950 dark:text-zinc-50 hover:underline"
        >
          {formatCourseCode(course.code)}
        </Link>
      </td>
      <td className="px-4 py-3">
        <div className="relative flex items-center gap-2 min-w-0 min-h-10">
          <span className="font-medium text-zinc-900 dark:text-zinc-100 line-clamp-2 min-w-0">{course.name}</span>
          {eligibility && <EligibilityBadge result={eligibility} />}
        </div>
      </td>
      <RatingCell value={course.rating?.useful} />
      <RatingCell value={course.rating?.easy} />
      <RatingCell value={course.rating?.liked} />
      <td className="px-4 py-3 text-right text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
        {reviews}
      </td>
      <td className="px-4 py-3 text-right text-xs tabular-nums">
        {seats == null ? (
          <span className="text-zinc-400">—</span>
        ) : seats > 0 ? (
          <span className="text-emerald-600 dark:text-emerald-400">{seats} open</span>
        ) : (
          <span className="text-zinc-400">Full</span>
        )}
      </td>
    </tr>
  );
}

function EligibilityBadge({ result }: { result: EligibilityResult }) {
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
        Check: {truncate(hint, 30)}
      </span>
    );
  }
  const missingCount = result.missingCourses.length;
  const missing = result.missingCourses.slice(0, 2).map(formatCourseCode).join(", ");
  const extra = missingCount > 2 ? ` +${missingCount - 2}` : "";
  const label = missingCount === 0 ? "Missing requirements" : `Missing ${missing}${extra}`;
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-200 px-1.5 py-0.5 text-[10px] font-medium"
      title={result.missingCourses.map(formatCourseCode).join(", ")}
    >
      {label}
    </span>
  );
}

function RatingCell({ value }: { value: number | null | undefined }) {
  if (value == null) {
    return <td className="px-4 py-3 text-right text-xs text-zinc-400">—</td>;
  }
  const pct = Math.round(value * 100);
  const color = pct >= 70 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-rose-500";
  return (
    <td className="px-4 py-3 text-right">
      <div className="inline-flex items-center gap-2 justify-end min-w-[64px]">
        <span className={`h-2 w-2 rounded-full ${color}`} />
        <span className="tabular-nums text-xs font-medium w-9 text-right">
          {formatPercent(value)}
        </span>
      </div>
    </td>
  );
}

function Th({
  label,
  col,
  current,
  dir,
  onSort,
  align = "left",
}: {
  label: string;
  col: SortKey;
  current: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = current === col;
  return (
    <th
      className={`px-4 py-2.5 font-medium text-zinc-700 dark:text-zinc-300 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      <button
        type="button"
        onClick={() => onSort(col)}
        className={`inline-flex items-center gap-1 hover:text-zinc-950 dark:hover:text-zinc-50 ${
          align === "right" ? "flex-row-reverse" : ""
        }`}
      >
        {label}
        {active && (
          <span className="text-xs text-zinc-400">{dir === "asc" ? "↑" : "↓"}</span>
        )}
      </button>
    </th>
  );
}

