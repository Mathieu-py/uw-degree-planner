/**
 * Sort state for the browse table. Kept out of FilterState because it's
 * presentation, not filtering, but encoded into the same URL alongside it.
 *
 * URL keys:  s = sort column, d = direction.
 */

import { seatsAvailable } from "./filters";
import type { Course } from "./types";

export type SortKey =
  | "code"
  | "name"
  | "useful"
  | "easy"
  | "liked"
  | "reviews"
  | "seats";
export type SortDir = "asc" | "desc";

const SORT_KEYS: ReadonlySet<SortKey> = new Set([
  "code",
  "name",
  "useful",
  "easy",
  "liked",
  "reviews",
  "seats",
]);

export const DEFAULT_SORT_KEY: SortKey = "useful";
export const DEFAULT_SORT_DIR: SortDir = "desc";

export const PAGE_SIZE = 50;
export const DEFAULT_PAGE = 1;

const NUMERIC: Record<
  Exclude<SortKey, "code" | "name">,
  (c: Course) => number
> = {
  useful: (c) => c.rating?.useful ?? -1,
  easy: (c) => c.rating?.easy ?? -1,
  liked: (c) => c.rating?.liked ?? -1,
  reviews: (c) => c.rating?.filled_count ?? -1,
  seats: (c) => seatsAvailable(c) ?? -1,
};

export function compareCourses(
  a: Course,
  b: Course,
  key: SortKey,
  dir: SortDir,
): number {
  const mul = dir === "asc" ? 1 : -1;
  switch (key) {
    case "code":
      return a.code.localeCompare(b.code) * mul;
    case "name":
      return a.name.localeCompare(b.name) * mul;
    case "useful":
    case "easy":
    case "liked":
    case "reviews":
    case "seats":
      return (NUMERIC[key](a) - NUMERIC[key](b)) * mul;
    default: {
      // Exhaustiveness guard: adding a new SortKey forces this to fail at compile time.
      const _exhaustive: never = key;
      return _exhaustive;
    }
  }
}

export function parseSortKey(raw: string | string[] | undefined): SortKey {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && SORT_KEYS.has(v as SortKey) ? (v as SortKey) : DEFAULT_SORT_KEY;
}

export function parseSortDir(raw: string | string[] | undefined): SortDir {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "asc" ? "asc" : "desc";
}

export function parsePage(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || !/^\d+$/.test(v)) return DEFAULT_PAGE;
  const n = parseInt(v, 10);
  return n >= 1 ? n : DEFAULT_PAGE;
}
