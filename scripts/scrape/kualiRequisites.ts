/**
 * Parsers for Kuali's structured course-requisite HTML (the `prerequisites`,
 * `corequisites`, `antirequisites` fields of a Kuali course detail). Build-time
 * only — the fetch script turns these into the structured fields stored in the
 * committed snapshot, so the runtime never parses HTML.
 *
 * Kuali renders each requisite as a nested rule tree: group headers ("Complete
 * all/N of the following") wrap `data-test="ruleView-X"` leaves; course refs are
 * `<a href="#/courses/view/{id}">CODE</a>` and program refs are
 * `<a href="#/programs/view/{id}">Name</a>`.
 */

import * as cheerio from "cheerio";
import { normalizeCourseCode } from "./normalize";

/** A Kuali requisite anchor that links to a course (not a program). */
const COURSE_ANCHOR_SELECTOR = 'a[href*="#/courses/view/"]';

/**
 * Every course code named anywhere in a Kuali `antirequisites` rule tree, in
 * document order, deduped. Antireqs are a flat conflict set — "credit will not
 * be granted for both" — so the boolean structure of the tree doesn't matter;
 * what matters is which courses are named.
 *
 * Program anchors ("Not open to students enrolled in …") are enrolment
 * restrictions, not course antirequisites, so they're excluded (course-href
 * anchors only).
 */
export function parseKualiAntireqCodes(
  html: string | null | undefined,
): string[] {
  if (!html || html.trim() === "") return [];
  const $ = cheerio.load(html);
  const codes = new Set<string>();
  $(COURSE_ANCHOR_SELECTOR).each((_, a) => {
    const code = normalizeCourseCode($(a).text());
    if (code) codes.add(code);
  });
  return [...codes];
}
