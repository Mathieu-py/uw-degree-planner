import * as cheerio from "cheerio";
import type { ElectiveCategory, RuleNode, TermLetter } from "../lib/programs";
import { isTermLetter, TERM_LETTERS } from "../lib/programs";

export function normalizeCourseCode(raw: string): string | null {
  const cleaned = raw.replace(/\s+/g, "").toUpperCase();
  const m = cleaned.match(/^([A-Z]{2,8})(\d{3,4}[A-Z]?)$/);
  return m ? (m[1] + m[2]).toLowerCase() : null;
}

export type ParseResult =
  | {
      kind: "engineering";
      terms: Record<TermLetter, RuleNode>;
      warnings: string[];
    }
  | { kind: "flexible"; rules: RuleNode; warnings: string[] }
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

const emptyTermsTree = (): Record<TermLetter, RuleNode> =>
  Object.fromEntries(
    TERM_LETTERS.map((t) => [t, { kind: "all", children: [] } as RuleNode]),
  ) as Record<TermLetter, RuleNode>;

const COMPLETE_ALL_RE = /^Complete all (the|of the) following/i;
const COMPLETE_N_OF_RE = /^Complete (\d+) of (the )?following/i;
const CHOOSE_ANY_RE = /^Choose any (?:of|course from) the following/i;
const COMPLETE_NO_MORE_THAN_RE =
  /^Complete no more than (\d+) from (the )?following/i;
const COMPLETE_N_FROM_CHOICES_RE =
  /^Complete (\d+) courses? from the following choices/i;
const SUBJECT_POOL_PREFIX_RE = /^Complete (\d+) additional\b/i;
const EXCLUDED_RE =
  /^The following cannot be used towards (?:this )?(?:academic )?plan/i;
// Catch-all for prose that doesn't fit any recognized rule shape. After #43
// removed "Choose" and the rule-tree refactor handles "Complete N additional
// …" as subject pools, what remains is genuinely unstructured prose: stray
// notes, conditional preambles without enumerable courses, exclusion clauses,
// and the unit-bound elective phrasings handled by `parseElectives`. "Choose"
// is deliberately absent so future Kuali drift on `Choose …` phrasings
// surfaces as warnings.
const DEFERRED_PROSE_RE =
  /^(?:Complete|The following|Note|If\b|Subject concentration)/i;

/**
 * Parse a Kuali program detail into a discriminated `ParseResult`.
 *
 * Field-selection precedence (first non-empty wins):
 *   1. `requiredCoursesTermByTerm` → engineering (per-term rule trees)
 *   2. `requirements`              → flexible (single rule tree)
 *   3. `courseRequirementsNoUnits` → flexible (single rule tree)
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
  const terms = emptyTermsTree();
  const warnings: string[] = [];
  const $ = cheerio.load(html);

  $("section").each((_, section) => {
    const $section = $(section);
    const header = $section
      .find('h2[data-testid="grouping-label"]')
      .text()
      .trim();
    const termLetter = parseTermLetter(header);
    if (!termLetter) return;

    const root = parseSectionTree(
      $,
      $section,
      `${programLabel} ${termLetter}`,
      warnings,
    );
    if (root.children.length > 0 || root.kind !== "all") {
      terms[termLetter] = root;
    }
  });

  return { kind: "engineering", terms, warnings };
}

function parseFlexible(html: string, programLabel: string): ParseResult {
  const allChildren: RuleNode[] = [];
  const warnings: string[] = [];
  const $ = cheerio.load(html);

  // Flexible programs may have one or more sections; merge them all under
  // one root `all` node. In practice it's a single "Required Courses"
  // section, but we don't depend on that.
  $("section").each((_, section) => {
    const root = parseSectionTree($, $(section), programLabel, warnings);
    if (root.kind === "all") allChildren.push(...root.children);
    else allChildren.push(root);
  });

  if (allChildren.length === 0) {
    return { kind: "empty", warnings };
  }

  return {
    kind: "flexible",
    rules: { kind: "all", children: allChildren },
    warnings,
  };
}

/**
 * Build a rule tree from a `<section>`. Walks the section's top-level `<ul>`
 * hierarchically rather than flattening every `ruleView-*` descendant. Two
 * parent-child shapes both produce a tree:
 *   - DOM-nested: `<li><span>Complete all of the following</span><ul>…children…</ul></li>`
 *   - Sibling-implied: a leaf `<li data-test="…">` containing meta-prose
 *     ("Complete N courses from the following choices:") consumes its
 *     subsequent same-level siblings as children.
 */
function parseSectionTree(
  $: cheerio.CheerioAPI,
  $section: ReturnType<cheerio.CheerioAPI>,
  contextLabel: string,
  warnings: string[],
): RuleNode & { kind: "all" } {
  const topUl = $section
    .children()
    .find("ul")
    .filter((_, ul) => $(ul).children("li").length > 0)
    .first();
  if (topUl.length === 0) return { kind: "all", children: [] };
  const children = walkUl($, topUl, contextLabel, warnings);
  return { kind: "all", children };
}

/**
 * Walk a `<ul>` and produce one RuleNode per logical child. Handles both
 * DOM-nested wrappers and sibling-implied meta-parent rules.
 */
function walkUl(
  $: cheerio.CheerioAPI,
  $ul: ReturnType<cheerio.CheerioAPI>,
  contextLabel: string,
  warnings: string[],
): RuleNode[] {
  const items = collectLiSiblings($, $ul);
  const out: RuleNode[] = [];
  for (let i = 0; i < items.length; i++) {
    const parsed = parseLi($, items[i], contextLabel, warnings);
    if (parsed === null) continue;
    if (parsed.kind === "metaParent") {
      // Consume subsequent siblings as children until end of ul or another
      // metaParent. Skipped (null) siblings are just noise; non-null siblings
      // become children.
      const children: RuleNode[] = [];
      let j = i + 1;
      while (j < items.length) {
        const next = parseLi($, items[j], contextLabel, warnings);
        if (next !== null) {
          if (next.kind === "metaParent") break;
          children.push(next.node);
        }
        j++;
      }
      out.push({
        kind: "pick",
        description: parsed.description,
        selectMin: parsed.selectMin,
        selectMax: parsed.selectMax,
        children,
      });
      i = j - 1;
      continue;
    }
    out.push(parsed.node);
  }
  return out;
}

/**
 * Gather a `<ul>`'s logical `<li>` children. Kuali sometimes wraps subsets
 * of children in a `<div>` (for the `rules_groupHeader_37` spacer) — we look
 * one level into those `<div>`s.
 */
function collectLiSiblings(
  $: cheerio.CheerioAPI,
  $ul: ReturnType<cheerio.CheerioAPI>,
): ReturnType<cheerio.CheerioAPI>[] {
  const out: ReturnType<cheerio.CheerioAPI>[] = [];
  $ul.children().each((_, child) => {
    const $child = $(child);
    if (
      child.type === "tag" &&
      (child as { tagName: string }).tagName === "li"
    ) {
      out.push($child);
    } else if (
      child.type === "tag" &&
      (child as { tagName: string }).tagName === "div"
    ) {
      $child.children("li").each((_, li) => {
        out.push($(li));
      });
    }
  });
  return out;
}

type ParsedLi =
  | { kind: "node"; node: RuleNode }
  | {
      kind: "metaParent";
      description?: string;
      selectMin?: number;
      selectMax?: number;
    };

function parseLi(
  $: cheerio.CheerioAPI,
  $li: ReturnType<cheerio.CheerioAPI>,
  contextLabel: string,
  warnings: string[],
): ParsedLi | null {
  // DOM-nested wrapper: <li>(no data-test) with a <span> + nested <ul>.
  const dataTest = $li.attr("data-test");
  if (!dataTest) {
    const $directChildren = $li.children();
    const $span = $directChildren.filter("span").first();
    const $childUl = $directChildren.filter("ul").first();
    if ($childUl.length === 0) return null;
    const wrapperText = $span.text().replace(/\s+/g, " ").trim();
    const children = walkUl($, $childUl, contextLabel, warnings);
    if (children.length === 0) return null;
    const wrapper = wrapWithProse(wrapperText, children);
    return { kind: "node", node: wrapper };
  }

  // Leaf rule: <li data-test="ruleView-X"> with <div data-test="ruleView-X-result"> inside.
  const $result = $li
    .children('div[data-test^="ruleView-"][data-test$="-result"]')
    .first();
  if ($result.length === 0) return null;

  const fullText = $result.text().replace(/\s+/g, " ").trim();
  const colonIdx = fullText.indexOf(":");
  const prefix =
    colonIdx >= 0 ? fullText.slice(0, colonIdx).trim() : fullText.slice(0, 200);
  const description = prefix.replace(/:\s*$/, "").trim();

  const codes = collectCourseCodes($, $result);

  if (COMPLETE_ALL_RE.test(prefix)) {
    if (codes.length === 0) return null;
    return { kind: "node", node: { kind: "courses", courses: codes } };
  }

  const nOf = COMPLETE_N_OF_RE.exec(prefix);
  if (nOf) {
    if (codes.length === 0) return null;
    const n = Number(nOf[1]);
    return {
      kind: "node",
      node: {
        kind: "pick",
        description,
        selectMin: n,
        selectMax: n,
        children: [{ kind: "courses", courses: codes }],
      },
    };
  }

  if (CHOOSE_ANY_RE.test(prefix)) {
    if (codes.length === 0) return null;
    return {
      kind: "node",
      node: {
        kind: "pick",
        description,
        children: [{ kind: "courses", courses: codes }],
      },
    };
  }

  const noMoreThan = COMPLETE_NO_MORE_THAN_RE.exec(prefix);
  if (noMoreThan) {
    if (codes.length === 0) return null;
    return {
      kind: "node",
      node: {
        kind: "pick",
        description,
        selectMax: Number(noMoreThan[1]),
        children: [{ kind: "courses", courses: codes }],
      },
    };
  }

  const metaParent = COMPLETE_N_FROM_CHOICES_RE.exec(prefix);
  if (metaParent) {
    const n = Number(metaParent[1]);
    return { kind: "metaParent", description, selectMin: n, selectMax: n };
  }

  if (EXCLUDED_RE.test(prefix)) {
    if (codes.length === 0) return null;
    return {
      kind: "node",
      node: { kind: "excluded", description, courses: codes },
    };
  }

  // Subject-pool prose. Try against the full text (the rule may have colons).
  const subjectPool = parseSubjectPool(fullText);
  if (subjectPool) return { kind: "node", node: subjectPool };

  if (DEFERRED_PROSE_RE.test(prefix)) return null;

  warnings.push(`${contextLabel}: unrecognized rule — "${prefix}"`);
  return null;
}

function collectCourseCodes(
  $: cheerio.CheerioAPI,
  $result: ReturnType<cheerio.CheerioAPI>,
): string[] {
  const codes = new Set<string>();
  $result.find("a").each((_, a) => {
    const code = normalizeCourseCode($(a).text());
    if (code) codes.add(code);
  });
  return [...codes].sort();
}

/**
 * Wrap a list of children based on the prose carried by a DOM wrapper `<li>`.
 * Only `Complete N of` is structurally meaningful here; everything else
 * (`Complete all of …`, or unrecognized prose) is treated as a plain `all`
 * since the children themselves carry the rule shape.
 */
function wrapWithProse(wrapperText: string, children: RuleNode[]): RuleNode {
  const nOf = COMPLETE_N_OF_RE.exec(wrapperText);
  if (nOf) {
    const n = Number(nOf[1]);
    return {
      kind: "pick",
      description: wrapperText,
      selectMin: n,
      selectMax: n,
      children,
    };
  }
  return children.length === 1 ? children[0] : { kind: "all", children };
}

/**
 * Parse a "Complete N additional …" rule into a `subjectPool` node. Returns
 * null if the prose doesn't match any known variant. Handles:
 *   - "Complete 2 additional STAT courses at the 300-level"
 *   - "Complete 3 additional PMATH courses at the 400-level"
 *   - "Complete 2 additional courses at the 300- or 400-level from: ACTSC, AMATH, CS, …"
 *   - "Complete 2 additional math courses at the 400-level from the following subject codes: ACTSC, AMATH, …"
 *   - "Complete 3 additional courses from: ACTSC, AMATH, CO, …"
 *   - Optional trailing exclusion clause separated by `;`.
 */
function parseSubjectPool(fullText: string): RuleNode | null {
  const head = SUBJECT_POOL_PREFIX_RE.exec(fullText);
  if (!head) return null;
  const selectCount = Number(head[1]);
  let rest = fullText.slice(head[0].length).trim();

  // Optional single-subject prefix ("STAT courses", "PMATH courses", "math courses").
  let subjectCodes: string[] = [];
  const subjMatch = rest.match(/^([A-Za-z]+)\s+courses?\b/);
  if (subjMatch) {
    const word = subjMatch[1];
    if (/^[A-Z]{2,8}$/.test(word)) subjectCodes = [word.toUpperCase()];
    rest = rest.slice(subjMatch[0].length).trim();
  } else if (/^courses?\b/i.test(rest)) {
    rest = rest.replace(/^courses?\b/i, "").trim();
  } else {
    return null;
  }

  // Optional "at the X-level" / "at the X- or Y-level".
  let minLevel: number | undefined;
  let maxLevel: number | undefined;
  const levelMatch = rest.match(
    /^at the\s+(\d+)(?:\s*-?\s*or\s+(\d+))?\s*-?\s*level\b/i,
  );
  if (levelMatch) {
    minLevel = Number(levelMatch[1]);
    if (levelMatch[2]) maxLevel = Number(levelMatch[2]);
    rest = rest.slice(levelMatch[0].length).trim();
  }

  // Optional "from [the following subject codes]: <list>[; <exclusion>]".
  let exclusions: string[] | undefined;
  const fromMatch = rest.match(
    /^from(?:\s+the\s+following\s+subject\s+codes)?:\s*(.+)$/i,
  );
  if (fromMatch) {
    const parts = fromMatch[1].split(";").map((p) => p.trim());
    const fromSubjects = parts[0]
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter((s) => /^[A-Z]{2,8}$/.test(s));
    if (fromSubjects.length > 0) subjectCodes = fromSubjects;
    if (parts.length > 1) {
      exclusions = parts.slice(1).filter((p) => p.length > 0);
    }
  }

  if (subjectCodes.length === 0) return null;

  return {
    kind: "subjectPool",
    description: fullText,
    selectCount,
    subjectCodes,
    ...(minLevel !== undefined ? { minLevel } : {}),
    ...(maxLevel !== undefined ? { maxLevel } : {}),
    ...(exclusions !== undefined ? { exclusions } : {}),
  };
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
