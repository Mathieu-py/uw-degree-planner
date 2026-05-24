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
import type { StudentPassage } from "./types";

export const COMPLETED_STORAGE_KEY = "uwfinder.completedCourses";

/**
 * Sibling flag recording that the last write to `completedCourses` came from a
 * transcript import (as opposed to a program seed or manual edit). Used by
 * StudentPassagePanel to decide between "rebase through baseline" (default) and
 * "replace with new baseline" (after transcript) on the next prog/term change.
 *
 * Persisted because the user might upload a transcript, close the tab, and
 * re-seed days later — the replace behavior should still fire.
 */
export const COMPLETED_FROM_TRANSCRIPT_KEY =
  "uwfinder.completedCoursesFromTranscript";

export function isCompletedFromTranscript(): boolean {
  return safeGetItem(COMPLETED_FROM_TRANSCRIPT_KEY) === "1";
}

export function markCompletedFromTranscript(): void {
  safeSetItem(COMPLETED_FROM_TRANSCRIPT_KEY, "1");
}

export function clearCompletedFromTranscriptFlag(): void {
  safeRemoveItem(COMPLETED_FROM_TRANSCRIPT_KEY);
}

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
 * Project the previous effective completedCourses through a program/term/spec
 * change. Extras (manually added beyond the old baseline) and removals
 * (baseline courses the user explicitly cleared) survive the rebase against
 * the new baseline. Clearing prog or term yields an empty new baseline, so
 * the list is preserved (everything counts as an extra).
 */
export function rebaseCompletedCourses(
  previous: StudentPassage,
  nextProgramId: string | null,
  nextCurrentTerm: string | null,
  nextSpecializationId: string | null,
): string[] {
  const oldBaseline = new Set(
    baselineForPassage(
      previous.programId,
      previous.currentTerm,
      previous.specializationId,
    ),
  );
  const oldEffective = new Set(previous.completedCourses);
  const extras = previous.completedCourses.filter((c) => !oldBaseline.has(c));
  const removals = new Set(
    [...oldBaseline].filter((c) => !oldEffective.has(c)),
  );

  const newBaseline = baselineForPassage(
    nextProgramId,
    nextCurrentTerm,
    nextSpecializationId,
  );
  return [...new Set([...newBaseline, ...extras])]
    .filter((c) => !removals.has(c))
    .sort();
}

/**
 * The inferred completed-courses baseline for a passage's prog/term/spec
 * triple. Flexible programs ignore the term, so a null term is allowed;
 * engineering with a null term yields the spec-only baseline (or [] if no
 * spec). Output is sorted because `inferCompleted` returns sorted.
 */
export function baselineForPassage(
  programId: string | null,
  term: string | null,
  specializationId: string | null,
): string[] {
  if (!programId) return [];
  const t = isTermLetter(term) ? term : null;
  return inferCompleted(programId, t, specializationId);
}
