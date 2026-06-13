/**
 * Memoized prereq AST parser. Parsing is pure over the input, so results are
 * shared process-wide via a Map keyed on raw text (empty string for
 * null/undefined). Grows unbounded — fine, the catalog has only ~10k unique
 * prereq strings, already in memory. Shared by the picker's eligibility
 * annotation and the plan validator (each previously had its own cache).
 */

import { type PrereqNode, parsePrereqs } from "./parse";

const prereqCache = new Map<string, PrereqNode | null>();

function cachedParsePrereqs(
  text: string | null | undefined,
): PrereqNode | null {
  const key = text ?? "";
  if (prereqCache.has(key)) return prereqCache.get(key) ?? null;
  const parsed = parsePrereqs(text);
  prereqCache.set(key, parsed);
  return parsed;
}

/** The minimum a course needs for prereq/coreq AST resolution. */
interface RequisiteSource {
  prereqAst?: PrereqNode | null;
  coreqAst?: PrereqNode | null;
  prereqs: string | null;
  coreqs: string | null;
}

/**
 * A course's prereq AST, preferring Kuali's structured `prereqAst`
 * (authoritative, parsed at build time) over the runtime parse of UWFlow's
 * free-text `prereqs` (fallback for courses Kuali doesn't cover). The single
 * switch point for prereq sourcing.
 */
export function resolvePrereqs(course: RequisiteSource): PrereqNode | null {
  return course.prereqAst ?? cachedParsePrereqs(course.prereqs);
}

/** A course's coreq AST — same contract as {@link resolvePrereqs}. */
export function resolveCoreqs(course: RequisiteSource): PrereqNode | null {
  return course.coreqAst ?? cachedParsePrereqs(course.coreqs);
}
