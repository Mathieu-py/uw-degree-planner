import * as cheerio from "cheerio";
import type { InformationalItem } from "../../../lib/programs";
import { cleanText } from "../util/dom";

/**
 * Parse Kuali's `additionalConstraints` HTML into progress-untracked
 * `informational` notes. This calendar prose is where a referenced list (e.g.
 * "List 1") is *defined* and where discretionary "see your advisor" rules live —
 * unstructurable, but dropping it lost the one sentence the student needs. See #117.
 *
 * One item per top-level `<p>`/`<li>` in document order (a nested sub-list stays
 * with its parent) — so intro prose that precedes a list isn't lost — falling
 * back to the whole blob when there's neither. Empty fragments dropped.
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

  // Top-level blocks in document order: a `<p>` or `<li>` not nested inside an
  // `<li>` (a nested sub-list stays in its parent's text). Emitting both keeps
  // intro prose that precedes a list, not just the list items.
  const blocks = $("p, li").filter(
    (_, el) => $(el).parents("li").length === 0,
  );
  if (blocks.length > 0) {
    blocks.each((_, el) => push($(el).text()));
    return items;
  }

  // Neither <p> nor <li> — fall back to the whole blob.
  push($.root().text());
  return items;
}
