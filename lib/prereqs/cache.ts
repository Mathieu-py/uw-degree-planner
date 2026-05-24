/**
 * Memoized prereq AST parser. Parsing is pure over the input string, so
 * results are shared process-wide via a Map keyed on the raw text (empty
 * string for null/undefined). The cache grows unbounded — fine because the
 * catalog only has ~10k unique prereq strings and they all live in memory
 * already.
 *
 * Used by both the picker's eligibility annotation (`lib/eligibility.ts`)
 * and the plan validator (`lib/plan/validate.ts`); previously each had its
 * own private cache, leading to duplicate parse work on every plan edit.
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
