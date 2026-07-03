import * as cheerio from "cheerio";
import type { InformationalItem } from "../../../lib/programs";
import { cleanText } from "../util/dom";

/**
 * Parse Kuali's `additionalConstraints` HTML into progress-untracked
 * `informational` notes. This calendar prose is where a referenced list (e.g.
 * "List 1") is *defined* and where discretionary "see your advisor" rules live —
 * unstructurable, but dropping it lost the one sentence the student needs. See #117.
 *
 * One item per top-level `<li>` (a nested sub-list stays with its parent),
 * falling back to `<p>` paragraphs then the whole blob. Empty fragments dropped.
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
