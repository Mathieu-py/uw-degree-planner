import * as cheerio from "cheerio";
import type { ElectiveCategory } from "../../lib/programs";
import { normalizeCourseCode } from "./normalize";

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
const WORD_NUMS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};
const NUM = "(\\d+|one|two|three|four|five|six|seven|eight|nine|ten)";
// The authoritative whole-requirement count ("Complete a total of 7 Technical
// Electives", "Complete a total of seven …").
const TOTAL_OF_RE = new RegExp(`\\bcomplete a total of\\s+${NUM}\\b`, "i");
// A list count: "Complete 6 of the following", "Complete one course from this
// list", "Complete two courses from the following choices".
const COMPLETE_COUNT_RE = new RegExp(
  `\\bcomplete\\s+${NUM}\\s+(?:course|of\\b|additional|from\\b)`,
  "i",
);
function numFromToken(tok: string): number | undefined {
  const n = WORD_NUMS[tok.toLowerCase()] ?? Number(tok);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * The requirement count *and* the statement it came from, so the two never
 * disagree. Prefers the authoritative "Complete a total of N" over a sub-list
 * "Complete N of the following"; returns undefined when no count is stated.
 */
function findCountStatement(
  texts: readonly string[],
): { count: number; text: string } | undefined {
  for (const re of [TOTAL_OF_RE, COMPLETE_COUNT_RE]) {
    for (const t of texts) {
      const m = re.exec(t);
      const n = m ? numFromToken(m[1]) : undefined;
      if (n !== undefined) return { count: n, text: t };
    }
  }
  return undefined;
}

// Pinned to "en" so description sorting is deterministic across machines
// regardless of LANG. Constructed once and reused.
const DESCRIPTION_COLLATOR = new Intl.Collator("en");

/**
 * Parse a Kuali program detail into `ElectiveCategory[]`.
 *
 * Two sources, emitted independently (no fuzzy matching between them):
 *   1. `graduationRequirements` — HTML prose with a bucket list like
 *      `<li>2.0 units of approved courses.</li>`. Yields entries with
 *      `description` + `unitRequirement`, no `approvedCourses`.
 *   2. `courseListsNew` — structured HTML (same `ruleView-*-result` shape as
 *      the required-courses parser) under a `<h2>Approved Courses List</h2>`
 *      heading. Yields entries with `description` + optional
 *      `unitRequirement` + `approvedCourses`.
 *
 * "Required courses" buckets are dropped from source 1 since those are
 * captured by `parseProgramRequirements`.
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

  // Merge by unitRequirement: a courseListsNew section with the same unit
  // count as a gradReqs bucket is the structured view of that same bucket.
  // Only merge when there's exactly one candidate bucket — if multiple
  // gradReqs entries share the unit count (e.g. "2.0 units of approved" AND
  // "2.0 units of communications"), we can't tell which one this list belongs
  // to, so push the courseList entry standalone rather than attaching it to
  // the wrong bucket.
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

  // Stable order: by unitRequirement ascending (entries without one sort
  // last), then by description. Locks diffs against Kuali reordering either
  // source.
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

  // Walk leaf <li> only. Parents like "Complete a total of 20.0 units:" wrap
  // the bucket list as a child <ul>, and their recursive .text() runs all
  // bucket items together (cheerio inserts no separators between tags), which
  // lets the regex span across siblings and capture garbage.
  $("li")
    .filter((_, li) => $(li).find("ul, ol").length === 0)
    .each((_, li) => {
      const text = $(li).text().replace(/\s+/g, " ").trim();
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
    const heading = $section
      .find('h2[data-testid="grouping-label"]')
      .text()
      .replace(/\s+/g, " ")
      .trim();

    const courses = $section
      .find("a")
      .toArray()
      .map((a) => normalizeCourseCode($(a).text()))
      .filter((c): c is string => c !== null);

    const ruleTexts = $section
      .find('div[data-test^="ruleView-"][data-test$="-result"]')
      .toArray()
      .map((r) => $(r).text().replace(/\s+/g, " ").trim());

    const unitMatch = ruleTexts
      .map((t) => COMPLETE_N_UNITS_RE.exec(t))
      .find((m): m is RegExpExecArray => m !== null);
    const unitRequirement = unitMatch ? Number(unitMatch[1]) : undefined;
    // Recover the course count (incl. spelled-out, e.g. "Complete one course
    // from this list") that was previously dropped — it turns a count-less list
    // into a trackable finite elective (SDE's 42 → "complete 6"; a "Complete
    // one course from this list" → a 1-of-N choice the ring can complete).
    const countSources = [heading, ...ruleTexts].filter(
      (t): t is string => t.length > 0,
    );
    // Count and verbatim sourceText come from the same statement so they can't
    // disagree (e.g. don't show count 3 next to "Complete a total of 7 …").
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

  // Stable order across re-runs, mirroring the choiceGroups sort in parseFlexible.
  out.sort((a, b) =>
    DESCRIPTION_COLLATOR.compare(a.description, b.description),
  );
  return out;
}
