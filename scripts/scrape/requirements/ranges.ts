// Course-range expansion (e.g. "CS340-CS398" → the offered catalog codes in
// band), exclusion-aware ("… excluding CS450-CS460"). Pure — no parse state.
import { catalogCodesInRange } from "../util/catalog";
import {
  CODE_RANGE_RE_G,
  normalizeCourseCode,
  parseCodeRange,
  TEXT_CODE_RE,
} from "../util/normalize";

// An exclusion clause consumes ONLY the codes/ranges that follow it — comma- or
// "and"-joined — and stops at the first non-code word, so a range re-introduced
// by prose ("… except CS350, and then CS440-CS489") survives while every
// comma-listed exclusion ("except CS350, CS440-CS489") is dropped. Never `.*$`:
// that swallowed valid trailing ranges. Matches inside parentheticals too.
export const EXCLUSION_LIST_RE =
  /\b(?:excluding|except|exclusive\s+of)\b(?:\s*(?:,|and)?\s*[A-Za-z]{2,8}\s?\d{3,4}[A-Za-z]?(?:\s*[-–—]\s*(?:[A-Za-z]{2,8}\s?)?\d{3,4}[A-Za-z]?)?)+/gi;

/** Every catalog code an exclusion clause names — its ranges expanded, then its
 *  bare literals — so they can be subtracted from an overlapping included band.
 *  Exported for a ReDoS regression test on EXCLUSION_LIST_RE. */
export function excludedCodes(text: string): Set<string> {
  const out = new Set<string>();
  for (const clause of text.match(EXCLUSION_LIST_RE) ?? []) {
    const noRanges = clause.replace(CODE_RANGE_RE_G, (m) => {
      const range = parseCodeRange(m);
      if (range) for (const c of catalogCodesInRange(range)) out.add(c);
      return " ";
    });
    for (const tok of noRanges.match(TEXT_CODE_RE) ?? []) {
      const code = normalizeCourseCode(tok);
      if (code) out.add(code);
    }
  }
  return out;
}

/**
 * Expand every INCLUDED course range in `text` ("CS340-CS398") to its offered
 * catalog codes, MINUS anything an exclusion clause names ("… excluding
 * CS450-CS460") — even when the excluded band sits inside an included one.
 * Parentheticals are notes/exclusions, never selectable. Empty when no range.
 */
export function expandRanges(text: string): string[] {
  const excluded = excludedCodes(text);
  const included = text.replace(/\([^)]*\)/g, " "); // notes/exclusions
  const out = new Set<string>();
  for (const m of included.matchAll(CODE_RANGE_RE_G)) {
    const range = parseCodeRange(m[0]);
    if (range) for (const c of catalogCodesInRange(range)) out.add(c);
  }
  for (const c of excluded) out.delete(c);
  return [...out];
}
