"use client";

import { useMemo, useState } from "react";
import { placedAntireqNamers } from "@/lib/courses/courseEligibility";
import {
  compareCourses,
  DEFAULT_SORT_DIR,
  DEFAULT_SORT_KEY,
  type SortDir,
  type SortKey,
} from "@/lib/courses/courseSort";
import { equivalenceForCatalog } from "@/lib/courses/equivalence";
import { applyFilters } from "@/lib/courses/filters";
import {
  attachEligibility,
  type EligibilityRow,
  type ShowFilter,
} from "@/lib/courses/rowEligibility";
import type { Course, FilterPreset } from "@/lib/courses/types";
import type { ProgramIdentity } from "@/lib/programs";

export interface PickerFilters {
  query: string;
  levels: number[];
  excludePrefixes: string[];
  includePrefixes: string[];
  minUseful: number | null;
  minEasy: number | null;
  hasSeatsOnly: boolean;
  show: ShowFilter;
}

const DEFAULT_FILTERS: PickerFilters = {
  query: "",
  levels: [],
  excludePrefixes: [],
  includePrefixes: [],
  minUseful: null,
  minEasy: null,
  hasSeatsOnly: false,
  show: "eligibleCheck",
};

const PAGE = 50;

export interface UseFilteredCoursesArgs {
  catalog: Course[];
  placedCodes: Set<string>;
  completedBefore: Set<string>;
  /** Target term's level (e.g. "2A") for resolving level-gated prereqs. */
  level?: string;
  /** Student's program(s) for resolving program-restriction prereqs (double degree → more than one). */
  programs?: ProgramIdentity[];
  /** Codes the student's program references (suppresses stale program blocks). */
  programReferenced?: ReadonlySet<string>;
  /** Codes already in the target slot (lets coreqs resolve same-term). */
  sameTerm?: ReadonlySet<string>;
  focusCodes?: string[];
  /** Filter values to seed on mount (e.g. a subject-pool Browse's subjects). */
  initialFilters?: FilterPreset;
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
 * Slot-picker filter+sort+paginate pipeline. Narrows the catalog to slot
 * candidates (not placed, optional focus list), then applies user filters,
 * search, prereq eligibility annotation, and sort. Pagination resets on every
 * filter/sort change.
 */
export function useFilteredCourses({
  catalog,
  placedCodes,
  completedBefore,
  level,
  programs,
  programReferenced,
  sameTerm,
  focusCodes,
  initialFilters,
}: UseFilteredCoursesArgs): UseFilteredCoursesResult {
  // Seed once on mount (the picker remounts per open), so a drill-in's preset
  // lands as the starting filter state, which the student can widen/narrow.
  const [filters, setFilters] = useState<PickerFilters>(() => ({
    ...DEFAULT_FILTERS,
    ...initialFilters,
  }));
  const [sortKey, setSortKey] = useState<SortKey>(DEFAULT_SORT_KEY);
  const [sortDir, setSortDir] = useState<SortDir>(DEFAULT_SORT_DIR);
  const [limit, setLimit] = useState(PAGE);

  const knownPrefixes = useMemo(
    () => [...new Set(catalog.map((c) => c.prefix))].sort(),
    [catalog],
  );

  // Reverse-antireq index over the placed courses, so a candidate is flagged
  // when a placed course names it even if its own list doesn't reciprocate.
  // Built over the REAL placed courses (not equivalents, which aren't placed).
  const antireqNamers = useMemo(
    () => placedAntireqNamers(catalog.filter((c) => placedCodes.has(c.code))),
    [catalog, placedCodes],
  );

  // Course equivalence (#21): a cross-listed twin of a placed/completed course
  // counts as that course. `placedExpanded` drives the antireq + already-placed
  // checks (a placed course's twin reads as taken); `completedExpanded` lets a
  // twin satisfy a prereq. Candidates exclude only the EXACT placed codes — a
  // twin stays in the list and renders greyed "already in plan" (like the
  // wrong-program case) rather than silently vanishing.
  const equiv = useMemo(() => equivalenceForCatalog(catalog), [catalog]);
  const placedExpanded = useMemo(
    () => equiv.expand(placedCodes),
    [equiv, placedCodes],
  );
  const completedExpanded = useMemo(
    () => equiv.expand(completedBefore),
    [equiv, completedBefore],
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
        includePrefixes: filters.includePrefixes,
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

  // Eligibility annotation is the most expensive step (parse + walk each prereq
  // AST). Split by mode:
  // - hideUnmetPrereqs true: MUST annotate everything before pagination, else
  //   an unmet row survives into a later page.
  // - hideUnmetPrereqs false: annotation is decorative, so defer past sort+slice
  //   and only evaluate the ~50 rendered rows (vs. the whole ~10k catalog per
  //   keystroke).
  const sortedCourses = useMemo<EligibilityRow[]>(() => {
    if (filters.show !== "all") {
      const baseRows = searched.map((course) => ({
        course,
        eligibility: null,
      }));
      const annotated = attachEligibility(baseRows, {
        completed: completedExpanded,
        placedAnywhere: placedExpanded,
        programReferenced,
        show: filters.show,
        level,
        programs,
        sameTerm,
        placedAntireqNamers: antireqNamers,
      });
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
  }, [
    searched,
    completedExpanded,
    placedExpanded,
    programReferenced,
    sameTerm,
    level,
    programs,
    antireqNamers,
    filters.show,
    sortKey,
    sortDir,
  ]);

  const visible = useMemo<EligibilityRow[]>(() => {
    const slice = sortedCourses.slice(0, limit);
    // In gating mode, slice rows already carry annotations from the
    // pre-pagination pass — re-annotating would be wasted work.
    if (filters.show !== "all") return slice;
    return attachEligibility(slice, {
      completed: completedExpanded,
      placedAnywhere: placedExpanded,
      programReferenced,
      show: "all",
      level,
      programs,
      sameTerm,
      placedAntireqNamers: antireqNamers,
    });
  }, [
    sortedCourses,
    limit,
    completedExpanded,
    placedExpanded,
    programReferenced,
    sameTerm,
    level,
    programs,
    antireqNamers,
    filters.show,
  ]);

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
