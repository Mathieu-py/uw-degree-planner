import * as cheerio from "cheerio";
import type { ElectiveCategory } from "../../lib/programs";
import { wordToNumber } from "./counts";
import {
  anchorCourseCodes,
  cleanText,
  RULE_RESULT_SELECTOR,
  SECTION_HEADING_SELECTOR,
} from "./dom";

export interface ElectivesDetailFields {
  graduationRequirements?: string;
  courseListsNew?: string;
}

export interface ParseElectivesResult {
  electives: ElectiveCategory[];
  warnings: string[];
}

// "5.5 units of elective courses", "2.0 units of approved courses".
const UNITS_OF_RE = /(\d+(?:\.\d+)?)\s*units?\s+of\s+([^.<]+)/i;
const REQUIRED_COURSES_RE = /required\s+courses?/i;
const COMPLETE_N_UNITS_RE = /Complete\s+(\d+(?:\.\d+)?)\s*units?/i;

// A finite course count from varied phrasings, including spelled-out numbers.
const NUM = "(\\d+|one|two|three|four|five|six|seven|eight|nine|ten)";
// The authoritative whole-requirement count ("Complete a total of 7 Technical
// Electives"). The negative lookahead rejects a unit total ("…3.5 units"), where
// the trailing \b would otherwise capture the integer part as a bogus count.
const TOTAL_OF_RE = new RegExp(
  `\\bcomplete a total of\\s+${NUM}(?!\\.\\d|\\s*units?)\\b`,
  "i",
);
// A list count: "Complete 6 of the following", "Complete one course from this
// list", "Complete two courses from the following choices".
const COMPLETE_COUNT_RE = new RegExp(
  `\\bcomplete\\s+${NUM}\\s+(?:course|of\\b|additional|from\\b)`,
  "i",
);
/**
 * The requirement count and the statement it came from, so they can't disagree.
 * Prefers "Complete a total of N" over a sub-list "Complete N of the following";
 * undefined when no count is stated.
 */
function findCountStatement(
  texts: readonly string[],
): { count: number; text: string } | undefined {
  for (const re of [TOTAL_OF_RE, COMPLETE_COUNT_RE]) {
    for (const t of texts) {
      const m = re.exec(t);
      const n = m ? wordToNumber(m[1]) : undefined;
      if (n !== undefined) return { count: n, text: t };
    }
  }
  return undefined;
}

// Pinned to "en" so description sorting is deterministic regardless of LANG.
const DESCRIPTION_COLLATOR = new Intl.Collator("en");

/**
 * Parse a Kuali detail into `ElectiveCategory[]` from two independent sources:
 *   1. `graduationRequirements` — prose buckets (`<li>2.0 units of approved
 *      courses.</li>`): `description` + `unitRequirement`, no `approvedCourses`.
 *   2. `courseListsNew` — structured HTML under an `Approved Courses List`
 *      heading: adds optional `approvedCourses`.
 *
 * "Required courses" buckets are dropped from source 1 (handled by
 * `parseProgramRequirements`).
 */
export function parseElectives(
  detail: ElectivesDetailFields,
  programLabel = "(unknown)",
): ParseElectivesResult {
  const warnings: string[] = [];

  const gradReqs = detail.graduationRequirements?.trim();
  const fromGradReqs = gradReqs ? parseGradReqsBuckets(gradReqs) : [];

  const courseLists = detail.courseListsNew?.trim();
  const fromCourseLists = courseLists
    ? parseCourseListsSections(courseLists, programLabel, warnings)
    : [];

  // Merge by unitRequirement: a courseListsNew section matching a gradReqs
  // bucket's unit count is its structured view. Merge only on an unambiguous
  // single match; otherwise push standalone rather than risk the wrong bucket.
  const electives: ElectiveCategory[] = [...fromGradReqs];
  for (const entry of fromCourseLists) {
    const matches =
      entry.unitRequirement !== undefined
        ? electives.filter(
            (e) =>
              e.unitRequirement === entry.unitRequirement &&
              e.approvedCourses === undefined,
          )
        : [];
    if (matches.length === 1 && entry.approvedCourses) {
      matches[0].approvedCourses = entry.approvedCourses;
    } else {
      electives.push(entry);
    }
  }

  // Stable order: unitRequirement ascending (none sorts last), then
  // description. Locks diffs against Kuali reordering either source.
  electives.sort((a, b) => {
    const ua = a.unitRequirement ?? Number.POSITIVE_INFINITY;
    const ub = b.unitRequirement ?? Number.POSITIVE_INFINITY;
    if (ua !== ub) return ua - ub;
    return DESCRIPTION_COLLATOR.compare(a.description, b.description);
  });

  return { electives, warnings };
}

function parseGradReqsBuckets(html: string): ElectiveCategory[] {
  const $ = cheerio.load(html);
  const out: ElectiveCategory[] = [];

  // Leaf <li> only. A parent's recursive .text() runs all bucket items together
  // (cheerio inserts no separators), letting the regex span siblings and
  // capture garbage.
  $("li")
    .filter((_, li) => $(li).find("ul, ol").length === 0)
    .each((_, li) => {
      const text = cleanText($(li).text());
      const m = text.match(UNITS_OF_RE);
      if (!m || REQUIRED_COURSES_RE.test(m[2])) return;
      out.push({ description: m[0], unitRequirement: Number(m[1]) });
    });

  return out;
}

function parseCourseListsSections(
  html: string,
  programLabel: string,
  warnings: string[],
): ElectiveCategory[] {
  const $ = cheerio.load(html);
  const out: ElectiveCategory[] = [];

  $("section").each((_, section) => {
    const $section = $(section);
    const heading = cleanText($section.find(SECTION_HEADING_SELECTOR).text());

    const courses = anchorCourseCodes($, $section);

    const ruleTexts = $section
      .find(RULE_RESULT_SELECTOR)
      .toArray()
      .map((r) => cleanText($(r).text()));

    const unitMatch = ruleTexts
      .map((t) => COMPLETE_N_UNITS_RE.exec(t))
      .find((m): m is RegExpExecArray => m !== null);
    const unitRequirement = unitMatch ? Number(unitMatch[1]) : undefined;
    // Recover the course count (incl. spelled-out) to turn a count-less list
    // into a trackable finite elective.
    const countSources = [heading, ...ruleTexts].filter(
      (t): t is string => t.length > 0,
    );
    // Count and sourceText come from the same statement so they can't disagree
    // (e.g. no count 3 next to "Complete a total of 7 …").
    const countStmt = findCountStatement(countSources);
    const requiredCount = countStmt?.count;
    const description = heading || ruleTexts[0];
    const sourceText =
      countStmt?.text ?? countSources.find((t) => /^Complete /i.test(t));

    if (!description) {
      if (courses.length > 0) {
        warnings.push(
          `${programLabel}: courseListsNew section had ${courses.length} course links but no <h2> heading or rule text`,
        );
      }
      return;
    }

    out.push({
      description,
      ...(unitRequirement !== undefined ? { unitRequirement } : {}),
      ...(requiredCount !== undefined ? { requiredCount } : {}),
      ...(sourceText ? { sourceText } : {}),
      ...(courses.length > 0
        ? { approvedCourses: [...new Set(courses)].sort() }
        : {}),
    });
  });

  // Stable order across re-runs, mirroring parseFlexible's choiceGroups sort.
  out.sort((a, b) =>
    DESCRIPTION_COLLATOR.compare(a.description, b.description),
  );
  return out;
}
