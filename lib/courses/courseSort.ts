/**
 * Sort state and comparator for course tables.
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

export const DEFAULT_SORT_KEY: SortKey = "useful";
export const DEFAULT_SORT_DIR: SortDir = "desc";

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
