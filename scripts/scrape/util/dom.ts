// Shared cheerio helpers for the Kuali program-detail parsers. The selectors
// and text normalization here were duplicated verbatim across requirements.ts,
// electives.ts, and degree.ts — centralizing them keeps the three parsers in
// lockstep when Kuali's markup shifts.
import type * as cheerio from "cheerio";
import { normalizeCourseCode } from "./normalize";

/** Kuali section heading element: `<h2 data-testid="grouping-label">`. */
export const SECTION_HEADING_SELECTOR = 'h2[data-testid="grouping-label"]';

/** Kuali leaf-rule result block: `<div data-test="ruleView-X-result">`. */
export const RULE_RESULT_SELECTOR =
  'div[data-test^="ruleView-"][data-test$="-result"]';

/** Collapse internal whitespace runs to single spaces and trim. */
export const cleanText = (text: string): string =>
  text.replace(/\s+/g, " ").trim();

/**
 * Course codes from every `<a>` within `$scope`, normalized to catalog form, in
 * document order (callers dedupe/sort as needed). Non-code anchor text drops.
 */
export function anchorCourseCodes(
  $: cheerio.CheerioAPI,
  $scope: ReturnType<cheerio.CheerioAPI>,
): string[] {
  const out: string[] = [];
  $scope.find("a").each((_, a) => {
    const code = normalizeCourseCode($(a).text());
    if (code) out.push(code);
  });
  return out;
}
