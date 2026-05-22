import * as cheerio from "cheerio";
import type { ChoiceGroup, TermLetter } from "../lib/programs";
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

  return { requiredCodes, choiceGroups, warnings };
}

function parseTermLetter(headerText: string): TermLetter | null {
  const m = headerText.match(/\b(\d[AB])\b/);
  return m && isTermLetter(m[1]) ? m[1] : null;
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
