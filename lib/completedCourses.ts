/**
 * localStorage-backed persistence for the user's completed-courses list.
 * Profile data (not URL state), so a shared browse URL describes only the
 * sender's view, never their academic history.
 *
 * `loadCompletedCourses` is defensive: corrupted JSON, non-array shapes,
 * and non-string items all degrade to an empty list — the catalog filters
 * still work, the user just sees no eligibility annotations.
 */

import { inferCompleted, isTermLetter } from "./programs";
import { safeGetItem, safeRemoveItem, safeSetItem } from "./storage";

export const COMPLETED_STORAGE_KEY = "uwfinder.completedCourses";

export function loadCompletedCourses(): string[] {
  const raw = safeGetItem(COMPLETED_STORAGE_KEY);
  if (raw == null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    safeRemoveItem(COMPLETED_STORAGE_KEY);
    return [];
  }
  if (!Array.isArray(parsed)) {
    safeRemoveItem(COMPLETED_STORAGE_KEY);
    return [];
  }
  return parsed
    .filter((c): c is string => typeof c === "string")
    .map((c) => c.toLowerCase());
}

export function saveCompletedCourses(courses: string[]): void {
  safeSetItem(COMPLETED_STORAGE_KEY, JSON.stringify(courses));
}

/**
 * Project the previous effective completedCourses through a program/term
 * change. Extras (manually added beyond the old baseline) and removals
 * (baseline courses the user explicitly cleared) survive the rebase against
 * the new baseline. Clearing prog or term yields an empty new baseline, so
 * the list is preserved (everything counts as an extra).
 */
export function rebaseCompletedCourses(
  previous: { programId: string | null; currentTerm: string | null; completedCourses: string[] },
  nextProgramId: string | null,
  nextCurrentTerm: string | null,
): string[] {
  const oldBaseline = new Set(
    previous.programId && isTermLetter(previous.currentTerm)
      ? inferCompleted(previous.programId, previous.currentTerm)
      : [],
  );
  const oldEffective = new Set(previous.completedCourses);
  const extras = previous.completedCourses.filter((c) => !oldBaseline.has(c));
  const removals = new Set([...oldBaseline].filter((c) => !oldEffective.has(c)));

  const newBaseline = nextProgramId && isTermLetter(nextCurrentTerm)
    ? inferCompleted(nextProgramId, nextCurrentTerm)
    : [];
  return [...new Set([...newBaseline, ...extras])]
    .filter((c) => !removals.has(c))
    .sort();
}
