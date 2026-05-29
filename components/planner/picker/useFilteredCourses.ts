"use client";

import { useMemo, useState } from "react";
import {
  compareCourses,
  DEFAULT_SORT_DIR,
  DEFAULT_SORT_KEY,
  type SortDir,
  type SortKey,
} from "@/lib/courses/courseSort";
import {
  attachEligibility,
  type EligibilityRow,
} from "@/lib/courses/eligibility";
import { applyFilters } from "@/lib/courses/filters";
import type { Course } from "@/lib/courses/types";

export interface PickerFilters {
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

const PAGE = 50;

export interface UseFilteredCoursesArgs {
  catalog: Course[];
  placedCodes: Set<string>;
  completedBefore: Set<string>;
  focusCodes?: string[];
}

export interface UseFilteredCoursesResult {
  filters: PickerFilters;
  sortKey: SortKey;
  sortDir: SortDir;
  knownPrefixes: string[];
  sorted: EligibilityRow[];
  visible: EligibilityRow[];
  hasMore: boolean;
  patchFilters: (p: Partial<PickerFilters>) => void;
  resetFilters: () => void;
  onSort: (key: SortKey) => void;
  showMore: () => void;
}

/**
 * Slot-picker filter+sort+paginate pipeline as a hook. The default view
 * narrows the catalog to candidates for the target slot (not placed, optional
 * focus list), then applies user filters, full-text search, prereq eligibility
 * annotation, and column sort. Pagination resets to the first page on every
 * filter / sort change.
 */
export function useFilteredCourses({
  catalog,
  placedCodes,
  completedBefore,
  focusCodes,
}: UseFilteredCoursesArgs): UseFilteredCoursesResult {
  const [filters, setFilters] = useState<PickerFilters>(DEFAULT_FILTERS);
  const [sortKey, setSortKey] = useState<SortKey>(DEFAULT_SORT_KEY);
  const [sortDir, setSortDir] = useState<SortDir>(DEFAULT_SORT_DIR);
  const [limit, setLimit] = useState(PAGE);

  const knownPrefixes = useMemo(
    () => [...new Set(catalog.map((c) => c.prefix))].sort(),
    [catalog],
  );

  const candidates = useMemo<Course[]>(() => {
    if (focusCodes && focusCodes.length > 0) {
      const want = new Set(focusCodes.map((c) => c.toLowerCase()));
      return catalog.filter(
        (c) => want.has(c.code) && !placedCodes.has(c.code),
      );
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
        c.name.toLowerCase().replace(/\s+/g, "").includes(q),
    );
  }, [userFiltered, filters.query]);

  // Eligibility annotation is the most expensive step (parsing every
  // course's prereq AST + walking it against the completed set). It splits
  // by mode:
  //
  // - `hideUnmetPrereqs === true`: we MUST annotate everything before
  //   pagination, otherwise an unmet row would survive into a later page.
  //   Correctness > perf here.
  //
  // - `hideUnmetPrereqs === false`: annotation is purely decorative, so we
  //   defer it past sort+slice and only evaluate the ~50 rows we render.
  //   Every keystroke in the search box used to re-evaluate the entire
  //   ~10k catalog; this brings it down to one screenful.
  const sortedCourses = useMemo<EligibilityRow[]>(() => {
    if (filters.hideUnmetPrereqs) {
      const baseRows = searched.map((course) => ({
        course,
        eligibility: null,
      }));
      const annotated = attachEligibility(baseRows, completedBefore, true);
      return [...annotated].sort((a, b) =>
        compareCourses(a.course, b.course, sortKey, sortDir),
      );
    }
    const baseRows = searched.map((course) => ({
      course,
      eligibility: null,
    }));
    return baseRows.sort((a, b) =>
      compareCourses(a.course, b.course, sortKey, sortDir),
    );
  }, [searched, completedBefore, filters.hideUnmetPrereqs, sortKey, sortDir]);

  const visible = useMemo<EligibilityRow[]>(() => {
    const slice = sortedCourses.slice(0, limit);
    // In gating mode, slice rows already carry annotations from the
    // pre-pagination pass — re-annotating would be wasted work.
    if (filters.hideUnmetPrereqs) return slice;
    return attachEligibility(slice, completedBefore, false);
  }, [sortedCourses, limit, completedBefore, filters.hideUnmetPrereqs]);

  // `sorted` is exposed for the candidate-count display and hasMore math;
  // nothing downstream reads `eligibility` off the off-page rows.
  const sorted = sortedCourses;
  const hasMore = sortedCourses.length > limit;

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

  function showMore() {
    setLimit((n) => n + PAGE);
  }

  return {
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
  };
}

export const PICKER_PAGE_SIZE = PAGE;
