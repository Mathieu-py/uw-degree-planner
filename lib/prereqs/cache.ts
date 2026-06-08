/**
 * Memoized prereq AST parser. Parsing is pure over the input, so results are
 * shared process-wide via a Map keyed on raw text (empty string for
 * null/undefined). Grows unbounded — fine, the catalog has only ~10k unique
 * prereq strings, already in memory. Shared by the picker's eligibility
 * annotation and the plan validator (each previously had its own cache).
 */

import { type PrereqNode, parsePrereqs } from "./parse";

const prereqCache = new Map<string, PrereqNode | null>();

export function cachedParsePrereqs(
  text: string | null | undefined,
): PrereqNode | null {
  const key = text ?? "";
  if (prereqCache.has(key)) return prereqCache.get(key) ?? null;
  const parsed = parsePrereqs(text);
  prereqCache.set(key, parsed);
  return parsed;
}
