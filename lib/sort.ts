/**
 * Sort + cap state for the browse table. Kept out of FilterState because it's
 * presentation, not filtering, but encoded into the same URL alongside it.
 *
 * URL keys:  s = sort column, d = direction, all = "1" disables the cap.
 */

import type { Course } from "./types";

export type SortKey = "code" | "name" | "useful" | "easy" | "liked" | "reviews" | "seats";
export type SortDir = "asc" | "desc";

const SORT_KEYS: ReadonlySet<SortKey> = new Set([
  "code", "name", "useful", "easy", "liked", "reviews", "seats",
]);

export const DEFAULT_SORT_KEY: SortKey = "useful";
export const DEFAULT_SORT_DIR: SortDir = "desc";
export const DEFAULT_LIMIT = 100;

const NUMERIC: Record<Exclude<SortKey, "code" | "name">, (c: Course) => number> = {
  useful: (c) => c.rating?.useful ?? -1,
  easy: (c) => c.rating?.easy ?? -1,
  liked: (c) => c.rating?.liked ?? -1,
  reviews: (c) => c.rating?.filled_count ?? -1,
  seats: (c) => seatsAvailable(c) ?? -1,
};

export function compareCourses(a: Course, b: Course, key: SortKey, dir: SortDir): number {
  const mul = dir === "asc" ? 1 : -1;
  if (key === "code") return a.code.localeCompare(b.code) * mul;
  if (key === "name") return a.name.localeCompare(b.name) * mul;
  const extract = NUMERIC[key];
  return (extract(a) - extract(b)) * mul;
}

export function parseSortKey(raw: string | string[] | undefined): SortKey {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && SORT_KEYS.has(v as SortKey) ? (v as SortKey) : DEFAULT_SORT_KEY;
}

export function parseSortDir(raw: string | string[] | undefined): SortDir {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "asc" ? "asc" : "desc";
}

export function parseShowAll(raw: string | string[] | undefined): boolean {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "1";
}

export function seatsAvailable(course: Course): number | null {
  if (course.sections.length === 0) return null;
  return course.sections.reduce(
    (sum, s) => sum + Math.max(0, s.enrollment_capacity - s.enrollment_total),
    0,
  );
}
