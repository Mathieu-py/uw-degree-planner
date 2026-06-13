import * as cheerio from "cheerio";
import type { InformationalItem } from "../../lib/programs";
import { cleanText } from "./dom";

/**
 * Parse Kuali's `additionalConstraints` HTML into informational notes shown
 * verbatim under the audit (progress-untracked).
 *
 * This field is calendar prose written for a human — it's where rules like a
 * program's "List 1" are *defined* and where genuinely discretionary rules live
 * ("CS 600-/700-level courses may be taken only with special permission from the
 * instructor and a CS academic advisor"). The rules parser can't structure these
 * (some are unverifiable by definition), but the single most useful sentence for
 * the student — what a referenced list actually means — was being dropped before
 * it reached the UI. Carrying it through as `informational` lets the student read
 * each rule next to the audit. See issue #117.
 *
 * One item per TOP-LEVEL `<li>` (a nested sub-list stays with its parent so
 * "Elective Requirement: …" keeps its heading), tags stripped to readable text.
 * Falls back to `<p>` paragraphs, then the whole cleaned blob, when there's no
 * list. Empty fragments are dropped.
 */
export function parseAdditionalConstraints(
  html: string | undefined,
): InformationalItem[] {
  if (!html?.trim()) return [];
  const $ = cheerio.load(html);

  const items: InformationalItem[] = [];
  const push = (text: string) => {
    const t = cleanText(text);
    if (t) items.push({ label: "Additional constraint", text: t });
  };

  // Top-level list items: an `<li>` not nested inside another `<li>`.
  const topLevel = $("li").filter((_, li) => $(li).parents("li").length === 0);
  if (topLevel.length > 0) {
    topLevel.each((_, li) => push($(li).text()));
    return items;
  }

  // No list — fall back to paragraphs, then the whole blob.
  const paras = $("p");
  if (paras.length > 0) {
    paras.each((_, p) => push($(p).text()));
    return items;
  }

  push($.root().text());
  return items;
}
