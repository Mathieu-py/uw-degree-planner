/**
 * localStorage-backed persistence for the user's completed-courses list.
 * Profile data (not URL state), so a shared browse URL describes only the
 * sender's view, never their academic history.
 *
 * Conceptual model:
 *   completedCourses = primary ∪ extras  (− local removals, not persisted)
 *     primary  — seeded set, either from a transcript import or from the
 *                program/spec/term baseline derived from StudentPassage.
 *     extras   — manual additions the user typed on top of the primary set.
 *     removals — courses the user explicitly removed from the displayed list.
 *                Local to the current seed only; discarded on the next re-seed.
 *
 * The `primary` set is not stored explicitly — it's recoverable from the
 * passage (for baseline-sourced) or implied by `completedCourses − extras`
 * (for transcript-sourced). What IS persisted: `completedCourses` (the
 * displayed list), `extras` (the manual layer), and `primarySource` (which
 * kind of primary we're on, mostly metadata for now).
 *
 * `loadCompletedCourses` is defensive: corrupted JSON, non-array shapes,
 * and non-string items all degrade to an empty list — the catalog filters
 * still work, the user just sees no eligibility annotations.
 */

import { pickedCoursesFor } from "./choiceGroups";
import { inferCompleted, isTermLetter } from "./programs";
import { safeGetItem, safeRemoveItem, safeSetItem } from "./storage";
import type { StudentPassage } from "./types";

export const COMPLETED_STORAGE_KEY = "uwfinder.completedCourses";
export const EXTRAS_STORAGE_KEY = "uwfinder.completedCoursesExtras";
export const PRIMARY_SOURCE_STORAGE_KEY =
  "uwfinder.completedCoursesPrimarySource";

/**
 * Legacy boolean flag (pre-primarySource): "1" meant the last write came from
 * a transcript import. Only read at migration time inside loadPrimarySource;
 * never written.
 */
const LEGACY_FROM_TRANSCRIPT_KEY = "uwfinder.completedCoursesFromTranscript";

export type PrimarySource = "transcript" | "baseline" | null;

export function loadCompletedCourses(): string[] {
  return loadCodeArray(COMPLETED_STORAGE_KEY);
}

export function saveCompletedCourses(courses: string[]): void {
  safeSetItem(COMPLETED_STORAGE_KEY, JSON.stringify(courses));
}

export function loadExtras(): string[] {
  return loadCodeArray(EXTRAS_STORAGE_KEY);
}

export function saveExtras(extras: string[]): void {
  safeSetItem(EXTRAS_STORAGE_KEY, JSON.stringify(extras));
}

export function loadPrimarySource(): PrimarySource {
  const raw = safeGetItem(PRIMARY_SOURCE_STORAGE_KEY);
  if (raw === "transcript" || raw === "baseline") return raw;
  if (raw != null) {
    safeRemoveItem(PRIMARY_SOURCE_STORAGE_KEY);
  }

  // Migration: legacy "1" flag → "transcript". Any other legacy value, or
  // none, falls back to inferring from whether there's a stored list. We
  // clear the legacy key either way so the migration is one-shot.
  const legacy = safeGetItem(LEGACY_FROM_TRANSCRIPT_KEY);
  if (legacy != null) {
    safeRemoveItem(LEGACY_FROM_TRANSCRIPT_KEY);
    if (legacy === "1") {
      savePrimarySource("transcript");
      return "transcript";
    }
  }

  const list = loadCompletedCourses();
  if (list.length > 0) {
    savePrimarySource("baseline");
    return "baseline";
  }
  return null;
}

export function savePrimarySource(source: PrimarySource): void {
  if (source == null) {
    safeRemoveItem(PRIMARY_SOURCE_STORAGE_KEY);
    return;
  }
  safeSetItem(PRIMARY_SOURCE_STORAGE_KEY, source);
}

/**
 * Project completedCourses through a re-seed gesture (program / term / spec /
 * picks change). The new list is the new program's baseline unioned with the
 * preserved extras layer. Removals from the prior seed are discarded.
 *
 * Clearing prog or term yields an empty baseline, so the result is just the
 * extras (the user's manual layer survives unrelated context changes).
 */
export function rebaseCompletedCourses(
  extras: string[],
  next: Pick<
    StudentPassage,
    "programId" | "currentTerm" | "specializationId" | "choiceGroupSelections"
  >,
): string[] {
  const baseline = baselineForPassage(
    next.programId,
    next.currentTerm,
    next.specializationId,
    next.choiceGroupSelections,
  );
  return [...new Set([...baseline, ...extras])].sort();
}

/**
 * The inferred completed-courses baseline for a passage's prog/term/spec/picks
 * tuple. `inferCompleted` returns the structural required-courses set;
 * `pickedCoursesFor` adds the codes the student picked for each choice group.
 * Flexible programs ignore the term, so a null term is allowed; engineering
 * with a null term yields the spec-and-picks baseline (or [] if no program).
 */
export function baselineForPassage(
  programId: string | null,
  term: string | null,
  specializationId: string | null,
  choiceGroupSelections: Record<string, string[]>,
): string[] {
  if (!programId) return [];
  const t = isTermLetter(term) ? term : null;
  const structural = inferCompleted(programId, t, specializationId);
  const picked = pickedCoursesFor(programId, choiceGroupSelections);
  return [...new Set([...structural, ...picked])].sort();
}

function loadCodeArray(key: string): string[] {
  const raw = safeGetItem(key);
  if (raw == null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    safeRemoveItem(key);
    return [];
  }
  if (!Array.isArray(parsed)) {
    safeRemoveItem(key);
    return [];
  }
  return parsed
    .filter((c): c is string => typeof c === "string")
    .map((c) => c.toLowerCase());
}
