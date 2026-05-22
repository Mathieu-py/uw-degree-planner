import * as cheerio from "cheerio";
import type {
  ChoiceGroup,
  ElectiveCategory,
  TermLetter,
} from "../lib/programs";
import { isTermLetter, TERM_LETTERS } from "../lib/programs";

export function normalizeCourseCode(raw: string): string | null {
  const cleaned = raw.replace(/\s+/g, "").toUpperCase();
  const m = cleaned.match(/^([A-Z]{2,8})(\d{3,4}[A-Z]?)$/);
  return m ? (m[1] + m[2]).toLowerCase() : null;
}

export type ParseResult =
  | {
      kind: "engineering";
      terms: Record<TermLetter, string[]>;
      choiceGroupsByTerm: Record<TermLetter, ChoiceGroup[]>;
      warnings: string[];
    }
  | {
      kind: "flexible";
      requiredCourses: string[];
      choiceGroups: ChoiceGroup[];
      warnings: string[];
    }
  | { kind: "empty"; warnings: string[] };

interface ProgramDetailFields {
  requiredCoursesTermByTerm?: string;
  requirements?: string;
  courseRequirementsNoUnits?: string;
}

interface ElectivesDetailFields {
  graduationRequirements?: string;
  courseListsNew?: string;
}

export interface ParseElectivesResult {
  electives: ElectiveCategory[];
  warnings: string[];
}

interface ExtractedRules {
  requiredCodes: Set<string>;
  choiceGroups: ChoiceGroup[];
  warnings: string[];
}

const emptyTerms = (): Record<TermLetter, string[]> =>
  Object.fromEntries(TERM_LETTERS.map((t) => [t, [] as string[]])) as Record<
    TermLetter,
    string[]
  >;

const emptyChoiceGroupsByTerm = (): Record<TermLetter, ChoiceGroup[]> =>
  Object.fromEntries(
    TERM_LETTERS.map((t) => [t, [] as ChoiceGroup[]]),
  ) as Record<TermLetter, ChoiceGroup[]>;

const COMPLETE_ALL_RE = /^Complete all (the|of the) following/i;
const COMPLETE_N_OF_RE = /^Complete (\d+) of (the )?following/i;
// Catch-all for descriptive prose, subject-restricted elective buckets,
// conditional notes, and exclusion lists — anything that isn't an explicit
// "Complete all/Complete N of the following" course-listing rule. Examples:
//   "Complete 2 additional STAT courses at the 300-level"
//   "Complete 1 approved elective" / "Complete 5.5 units of …"
//   "Complete 2 Technical Electives from List 1"
//   "Complete the List 1 and List 2 requirements below"
//   "Choose any of the following" / "Complete no more than 1 from the following"
//   "The following cannot be used towards this academic plan"
//   "Note", "If CO255 is taken…", "Subject concentration"
// Capturing these properly needs ElectiveCategory / conditional modeling and
// is deferred to a follow-up issue per ADR 0001 §118-127.
const DEFERRED_PROSE_RE =
  /^(?:Complete|Choose|The following|Note|If\b|Subject concentration)/i;

/**
 * Parse a Kuali program detail into a discriminated `ParseResult`.
 *
 * Field-selection precedence (first non-empty wins):
 *   1. `requiredCoursesTermByTerm` → engineering (per-term schedule)
 *   2. `requirements`              → flexible (flat required list)
 *   3. `courseRequirementsNoUnits` → flexible (flat required list)
 *
 * The `requirements` and `courseRequirementsNoUnits` fields are HTML-equivalent
 * — Kuali emits the same `<section><h2>Required Courses</h2>...` shape into
 * one or the other depending on whether unit counts are tracked.
 */
export function parseProgramRequirements(
  detail: ProgramDetailFields,
  programLabel = "(unknown)",
): ParseResult {
  const engHtml = detail.requiredCoursesTermByTerm?.trim();
  if (engHtml) return parseEngineering(engHtml, programLabel);

  const reqHtml = detail.requirements?.trim();
  if (reqHtml) return parseFlexible(reqHtml, programLabel);

  const noUnitsHtml = detail.courseRequirementsNoUnits?.trim();
  if (noUnitsHtml) return parseFlexible(noUnitsHtml, programLabel);

  return { kind: "empty", warnings: [] };
}

function parseEngineering(html: string, programLabel: string): ParseResult {
  const terms = emptyTerms();
  const choiceGroupsByTerm = emptyChoiceGroupsByTerm();
  const warnings: string[] = [];
  const $ = cheerio.load(html);

  $("section").each((_, section) => {
    const header = $(section)
      .find('h2[data-testid="grouping-label"]')
      .text()
      .trim();
    const termLetter = parseTermLetter(header);
    if (!termLetter) return;

    const extracted = extractRules(
      $,
      $(section),
      `${programLabel} ${termLetter}`,
    );
    if (extracted.requiredCodes.size > 0) {
      terms[termLetter] = [...extracted.requiredCodes].sort();
    }
    if (extracted.choiceGroups.length > 0) {
      choiceGroupsByTerm[termLetter] = extracted.choiceGroups;
    }
    warnings.push(...extracted.warnings);
  });

  return { kind: "engineering", terms, choiceGroupsByTerm, warnings };
}

function parseFlexible(html: string, programLabel: string): ParseResult {
  const requiredCodes = new Set<string>();
  const choiceGroups: ChoiceGroup[] = [];
  const warnings: string[] = [];
  const $ = cheerio.load(html);

  // Flexible programs may have one or more sections; merge them all into one
  // bucket. In practice it's a single "Required Courses" section, but we
  // don't depend on that.
  $("section").each((_, section) => {
    const extracted = extractRules($, $(section), programLabel);
    for (const c of extracted.requiredCodes) requiredCodes.add(c);
    choiceGroups.push(...extracted.choiceGroups);
    warnings.push(...extracted.warnings);
  });

  // Sort choiceGroups by first option for stable JSON across re-runs.
  choiceGroups.sort((a, b) =>
    (a.options[0] ?? "").localeCompare(b.options[0] ?? ""),
  );

  if (requiredCodes.size === 0 && choiceGroups.length === 0) {
    return { kind: "empty", warnings };
  }

  return {
    kind: "flexible",
    requiredCourses: [...requiredCodes].sort(),
    choiceGroups,
    warnings,
  };
}

function extractRules(
  $: cheerio.CheerioAPI,
  $section: ReturnType<cheerio.CheerioAPI>,
  contextLabel: string,
): ExtractedRules {
  const requiredCodes = new Set<string>();
  const choiceGroups: ChoiceGroup[] = [];
  const warnings: string[] = [];

  $section
    .find('div[data-test^="ruleView-"][data-test$="-result"]')
    .each((_, rule) => {
      const fullText = $(rule).text();
      const colonIdx = fullText.indexOf(":");
      const prefix = fullText
        .slice(0, colonIdx >= 0 ? colonIdx : 120)
        .replace(/\s+/g, " ")
        .trim();

      if (COMPLETE_ALL_RE.test(prefix)) {
        $(rule)
          .find("a")
          .each((_, a) => {
            const code = normalizeCourseCode($(a).text());
            if (code) requiredCodes.add(code);
          });
        return;
      }

      const nOf = COMPLETE_N_OF_RE.exec(prefix);
      if (nOf) {
        const opts = new Set<string>();
        $(rule)
          .find("a")
          .each((_, a) => {
            const code = normalizeCourseCode($(a).text());
            if (code) opts.add(code);
          });
        if (opts.size > 0) {
          choiceGroups.push({
            description: prefix.replace(/:\s*$/, "").trim(),
            selectCount: Number(nOf[1]),
            options: [...opts].sort(),
          });
        }
        return;
      }

      if (DEFERRED_PROSE_RE.test(prefix)) return;

      // Unrecognized prefix — record so Kuali wording drift is visible.
      warnings.push(`${contextLabel}: unrecognized rule — "${prefix}"`);
    });

  const seen = new Set<string>();
  const dedupedChoiceGroups = choiceGroups.filter((g) => {
    const key = `${g.selectCount ?? 1}|${g.options.join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { requiredCodes, choiceGroups: dedupedChoiceGroups, warnings };
}

function parseTermLetter(headerText: string): TermLetter | null {
  const m = headerText.match(/\b(\d[AB])\b/);
  return m && isTermLetter(m[1]) ? m[1] : null;
}

// "5.5 units of elective courses", "2.0 units of approved courses".
const UNITS_OF_RE = /(\d+(?:\.\d+)?)\s*units?\s+of\s+([^.<]+)/i;
const REQUIRED_COURSES_RE = /required\s+courses?/i;
const COMPLETE_N_UNITS_RE = /Complete\s+(\d+(?:\.\d+)?)\s*units?/i;

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
    return a.description.localeCompare(b.description);
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
    const description = heading || ruleTexts[0];

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
      ...(courses.length > 0
        ? { approvedCourses: [...new Set(courses)].sort() }
        : {}),
    });
  });

  // Stable order across re-runs, mirroring the choiceGroups sort in parseFlexible.
  out.sort((a, b) => a.description.localeCompare(b.description));
  return out;
}

const CREDENTIAL_PREFIX_RE = /^(h|jh|3g|4g)-/;

function rawSlug(code: string): string {
  return code
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Build a kebab-case slug for a program's `code` field (e.g.
 * "H-Systems Design Engineering" → "systems-design-engineering").
 *
 * The credential prefix (H, JH, 3G, 4G) is stripped by default since
 * Honours is the common case and the prefix is noise. If multiple
 * programs would collapse to the same stripped slug, the prefix is
 * retained for disambiguation (e.g. "h-anthropology" vs "3g-anthropology").
 *
 * `conflictCounts` must map every program's *stripped* slug to the total
 * count of programs sharing it.
 */
export function buildProgramSlug(
  code: string,
  conflictCounts: ReadonlyMap<string, number>,
): string {
  const full = rawSlug(code);
  const stripped = full.replace(CREDENTIAL_PREFIX_RE, "");
  const collisions = conflictCounts.get(stripped) ?? 0;
  return collisions > 1 ? full : stripped;
}

export function buildConflictCounts(
  codes: readonly string[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of codes) {
    const stripped = rawSlug(c).replace(CREDENTIAL_PREFIX_RE, "");
    counts.set(stripped, (counts.get(stripped) ?? 0) + 1);
  }
  return counts;
}
