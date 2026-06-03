import * as cheerio from "cheerio";
import type {
  DegreeRequirements,
  ElectiveCategory,
  InformationalItem,
  RuleNode,
  TermLetter,
  UnitBucket,
  UnitConstraint,
  UnitPlan,
  UnitScope,
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
        ...(parsed.description !== undefined
          ? { description: parsed.description }
          : {}),
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
    if (child.type === "tag" && child.name === "li") {
      out.push($child);
    } else if (child.type === "tag" && child.name === "div") {
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
        selectMax: Number(noMoreThan[1]),
        children: [{ kind: "courses", courses: codes }],
      },
    };
  }

  const metaParent = COMPLETE_N_FROM_CHOICES_RE.exec(prefix);
  if (metaParent) {
    const n = Number(metaParent[1]);
    return { kind: "metaParent", selectMin: n, selectMax: n };
  }

  if (EXCLUDED_RE.test(prefix)) {
    if (codes.length === 0) return null;
    return {
      kind: "node",
      node: { kind: "excluded", courses: codes },
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
 *
 * Wrapper text matching the recognized "Complete all of the following" or
 * "Complete N of the following" forms is dropped — `describeRule()` will
 * reconstruct it from structure. Non-standard wrapper prose (none in current
 * data; defensive future-proofing) is preserved on the node and consumers
 * fall back to it before deriving.
 */
function wrapWithProse(wrapperText: string, children: RuleNode[]): RuleNode {
  const nOf = COMPLETE_N_OF_RE.exec(wrapperText);
  if (nOf) {
    const n = Number(nOf[1]);
    return {
      kind: "pick",
      selectMin: n,
      selectMax: n,
      children,
    };
  }
  // Drop wrapper text only when it matches the standard `Complete all …` form.
  // Anything else is non-standard prose that's worth preserving verbatim — even
  // on the single-child fast path, where unwrapping would otherwise lose it.
  const isStandardAll = COMPLETE_ALL_RE.test(wrapperText);
  if (children.length === 1 && (!wrapperText || isStandardAll)) {
    return children[0];
  }
  return {
    kind: "all",
    ...(wrapperText && !isStandardAll ? { description: wrapperText } : {}),
    children,
  };
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
    // Recover the "Complete N of the following" count that was previously
    // dropped — it turns a count-less "Technical Electives List" into a
    // trackable finite elective (e.g. SDE's list of 42 → "complete N").
    const countMatch = ruleTexts
      .map((t) => /Complete\s+(\d+)\s+of (?:the )?following/i.exec(t))
      .find((m): m is RegExpExecArray => m !== null);
    const requiredCount = countMatch ? Number(countMatch[1]) : undefined;
    const description = heading || ruleTexts[0];
    // The verbatim rule statement, shown to the student so the exact wording
    // (and any caveats the count can't capture) is preserved.
    const sourceText = ruleTexts.find((t) => /^Complete /i.test(t));

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

/* ----------------------- unit-accounting parser ------------------------- */

// UW "math courses" (Faculty of Mathematics) — the subject set that satisfies
// "N units of math courses"; "non-math" is the complement. This is UW's
// documented Faculty-of-Mathematics subject set (not inferred).
const MATH_SUBJECTS = ["math", "amath", "pmath", "co", "cs", "stat", "actsc"];

// Named subjects that appear spelled-out (no all-caps code) in unit prose, with
// an unambiguous single subject code.
const SUBJECT_NAME_MAP: Array<[RegExp, string[]]> = [
  [/classical studies/i, ["clas"]],
  [/social work/i, ["socwk"]],
];

const TOTAL_UNITS_RE = /complete a total of\s+(\d+(?:\.\d+)?)\s*units/i;
const ADDITIONAL_SUBJ_UNITS_RE =
  /(\d+(?:\.\d+)?)\s+additional\s+([A-Z]{2,8})\s+units/;
// "minimum of 14.5 units must be at the 200-level or above"
const LEVEL_CONSTRAINT_RE =
  /(\d+(?:\.\d+)?)\s*units?\b[^.]*?\bat the\s+(\d)00-level\s+or above/i;
const FAILED_UNITS_RE = /maximum of\s+(\d+(?:\.\d+)?)\s*(?:failed )?units/i;

/**
 * Map a unit-bucket noun phrase ("required courses", "HIST and approved
 * courses", "non-math") to a scope, or `null` when we can't resolve it to a
 * concrete, verifiable scope (no guessing). Order matters: a named subject must
 * win over the generic "approved/elective courses" fallback, since UW phrases a
 * subject requirement as "N units of HIST and approved courses". A `null` scope
 * is surfaced verbatim as an informational requirement instead of being
 * allocated against a fabricated subject set.
 */
function scopeFromNoun(noun: string): UnitScope | null {
  const n = noun.trim();
  // Faculty of Math group (documented subject set).
  if (/non[\s-]?math/i.test(n))
    return { kind: "subjectExcept", exclude: MATH_SUBJECTS };
  if (/\bmath(?:ematics)? courses?\b/i.test(n) && !/\bscience\b/i.test(n))
    return { kind: "subject", subjects: MATH_SUBJECTS };
  // "Science courses/electives" — UW has no keyless authoritative Faculty-of-
  // Science subject list, so we don't guess one; surfaced verbatim instead.
  if (
    /\bscience\b/i.test(n) &&
    !/\b(?:required|social|computer|data|management)\b/i.test(n)
  )
    return null;
  // An explicit subject code (HIST, GSJ, …) — before the approved/elective
  // fallback so "HIST and approved courses" scopes to HIST.
  const m = n.match(/\b([A-Z]{2,7})\b/);
  if (m && m[1] !== "UCR") return { kind: "subject", subjects: [m[1].toLowerCase()] };
  // A spelled-out named subject ("Classical Studies", "Social Work").
  for (const [re, subjects] of SUBJECT_NAME_MAP)
    if (re.test(n)) return { kind: "subject", subjects };
  // "required … courses" or "lecture/lab courses listed/see below" → the
  // program's own required set (the "below" list is the required-course table).
  if (
    (/\brequired\b/i.test(n) && /\bcourses?\b/i.test(n)) ||
    (/\blecture\b/i.test(n) && /\b(?:listed|see) below\b/i.test(n))
  )
    return { kind: "required" };
  // Genuine free electives ("electives", "approved courses", "courses, any level").
  if (/\b(?:electives?|approved)\b/i.test(n) || /any level/i.test(n))
    return { kind: "open" };
  // Anything else (e.g. "Arts and Business courses", "breadth courses") — we
  // can't verify the exact scope, so don't fabricate one.
  return null;
}

export interface UnitPlanResult {
  unitPlan: UnitPlan | null;
  informational: InformationalItem[];
  /** Referenced "Bachelor of X degree-level requirements" Kuali pid, if any. */
  degreeRef: { pid: string; name: string } | null;
  warnings: string[];
}

/**
 * Parse the `graduationRequirements` prose into a unit plan: a total, the unit
 * buckets ("9.0 units of required courses", "7.0 additional BIOL units",
 * "5.5 units of elective courses"), level constraints, plus informational notes
 * (failed-unit caps, communication prose) and the degree-level reference.
 */
export function parseUnitPlan(
  html: string,
  programLabel = "(unknown)",
): UnitPlanResult {
  const $ = cheerio.load(html);
  const warnings: string[] = [];
  const buckets: UnitBucket[] = [];
  const constraints: UnitConstraint[] = [];
  const informational: InformationalItem[] = [];

  // Degree-level reference: <a href="#/programs/PID">Bachelor of X degree-level…</a>
  let degreeRef: { pid: string; name: string } | null = null;
  $("a").each((_, a) => {
    const href = $(a).attr("href") ?? "";
    const text = $(a).text().replace(/\s+/g, " ").trim();
    const m = href.match(/#\/programs\/([A-Za-z0-9_-]+)/);
    if (m && /degree-level requirements/i.test(text)) {
      degreeRef = { pid: m[1], name: text };
    }
  });

  // The "Complete a total of N units:" line is usually a parent <li> wrapping
  // the bucket sub-list, so read the total from the whole document text.
  const totalMatch = $.root().text().match(TOTAL_UNITS_RE);
  const totalUnits = totalMatch ? Number(totalMatch[1]) : undefined;
  let bucketIdx = 0;

  // Walk every leaf <li>; classify by phrasing.
  $("li")
    .filter((_, li) => $(li).find("ul, ol").length === 0)
    .each((_, li) => {
      const text = $(li).text().replace(/\s+/g, " ").trim();
      if (!text) return;

      const level = text.match(LEVEL_CONSTRAINT_RE);
      if (level) {
        constraints.push({
          label: text,
          minUnits: Number(level[1]),
          minLevel: Number(level[2]) * 100,
          sourceText: text,
        });
        return;
      }

      const failed = text.match(FAILED_UNITS_RE);
      if (failed) {
        informational.push({ label: "Failed units", text });
        return;
      }

      // "7.0 additional BIOL units"
      const addl = text.match(ADDITIONAL_SUBJ_UNITS_RE);
      if (addl) {
        buckets.push({
          id: `u${bucketIdx++}`,
          label: text,
          requiredUnits: Number(addl[1]),
          scope: { kind: "subject", subjects: [addl[2].toLowerCase()] },
          sourceText: text,
        });
        return;
      }

      // "N units of <noun>". A bare "Complete a total of N units:" header has no
      // "of <noun>" so it won't match; a combined "total of N units of HIST…"
      // (no sub-list) legitimately yields one bucket.
      const unitsOf = text.match(UNITS_OF_RE);
      if (unitsOf) {
        const scope = scopeFromNoun(unitsOf[2]);
        if (scope === null) {
          // No verifiable scope — surface the exact requirement, don't fake it.
          informational.push({ label: "Unit requirement", text });
          warnings.push(`${programLabel}: untracked unit scope: "${unitsOf[2]}"`);
        } else {
          buckets.push({
            id: `u${bucketIdx++}`,
            label: text,
            requiredUnits: Number(unitsOf[1]),
            scope,
            sourceText: text,
          });
        }
      }
    });

  // Communication prose lives in a <p> after an <h4>Undergraduate Communications…
  const commText = $("h4")
    .filter((_, h) => /communication/i.test($(h).text()))
    .next("p")
    .text()
    .replace(/\s+/g, " ")
    .trim();
  if (commText) {
    informational.push({ label: "Communication requirement", text: commText });
  }

  // Sanity guard: if the buckets we parsed require more units than the total we
  // parsed, the "total" we grabbed is a sub-statement, not the degree total
  // (prose ambiguity). Drop it rather than report a total we can't trust.
  const bucketSum = buckets.reduce((s, b) => s + b.requiredUnits, 0);
  const resolvedTotal =
    totalUnits !== undefined && bucketSum > totalUnits + 0.01
      ? undefined
      : totalUnits;
  if (resolvedTotal === undefined && totalUnits !== undefined) {
    warnings.push(
      `${programLabel}: dropped inconsistent total ${totalUnits} (buckets sum to ${bucketSum})`,
    );
  }

  const unitPlan: UnitPlan | null =
    buckets.length > 0 || constraints.length > 0 || resolvedTotal !== undefined
      ? {
          ...(resolvedTotal !== undefined ? { totalUnits: resolvedTotal } : {}),
          buckets,
          ...(constraints.length > 0 ? { constraints } : {}),
        }
      : null;

  return { unitPlan, informational, degreeRef, warnings };
}

/**
 * Reconcile the unit plan (from grad-req prose) with the elective lists (from
 * courseListsNew) so a requirement isn't counted twice:
 *  - A pure unit bucket already in the plan ("5.5 units of elective courses",
 *    no course list) is dropped from `electives` — the plan owns it.
 *  - An approved list whose unit count matches an open plan bucket links into
 *    that bucket as a concrete `list` scope (and is dropped from `electives`).
 *  - Finite count-based lists ("Technical Electives List: complete 6 of …")
 *    with no matching unit bucket stay as electives.
 */
export function reconcileUnitsAndElectives(
  unitPlan: UnitPlan | null,
  electives: ElectiveCategory[],
): {
  unitPlan: UnitPlan | null;
  electives: ElectiveCategory[];
  linked: number;
} {
  const isPureUnitBucket = (e: ElectiveCategory) =>
    e.unitRequirement != null &&
    !(e.approvedCourses && e.approvedCourses.length > 0) &&
    e.requiredCount == null;

  if (!unitPlan) {
    return {
      unitPlan,
      electives: electives.filter((e) => !isPureUnitBucket(e)),
      linked: 0,
    };
  }

  const buckets = unitPlan.buckets.map((b) => ({ ...b }));
  const kept: ElectiveCategory[] = [];
  let linked = 0;
  for (const e of electives) {
    if (isPureUnitBucket(e)) continue; // plan owns it
    if (e.unitRequirement != null && e.approvedCourses?.length) {
      const target = buckets.find(
        (b) => b.scope.kind === "open" && b.requiredUnits === e.unitRequirement,
      );
      if (target) {
        target.scope = { kind: "list", courses: e.approvedCourses };
        if (e.sourceText && !target.sourceText)
          target.sourceText = e.sourceText;
        linked++;
        continue;
      }
    }
    kept.push(e);
  }
  return { unitPlan: { ...unitPlan, buckets }, electives: kept, linked };
}

/* --------------------- degree-level requirements ------------------------ */

interface DegreeDetailFields {
  title?: string;
  degreeRequirements?: string;
  minimumAverageSRequired?: string;
  coOperativeRequirementsUndergraduate?: string;
}

export interface DegreeParseResult {
  degree: DegreeRequirements;
  /** Honours-degree total, propagated to honours majors lacking their own. */
  honoursTotal?: number;
  /** Three/four-year general-degree total, for the `3g-`/`4g-` majors. */
  generalTotal?: number;
  warnings: string[];
}

// Faculties phrase the total as either "Complete a total of N units" (Arts) or
// "Complete a minimum of N units" (Math), per degree type.
const HONOURS_TOTAL_RE =
  /honours[^.]*?(?:total|minimum) of\s+(\d+(?:\.\d+)?)\s*units/i;
const GENERAL_TOTAL_RE =
  /(?:three-year general|four-year general|general degree)[^.]*?(?:total|minimum) of\s+(\d+(?:\.\d+)?)\s*units/i;
const UNIT_AMOUNT_RE = /(\d+(?:\.\d+)?)\s*units?/i;

function stripHtml(html: string | undefined): string {
  return (html ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse a faculty "Bachelor of X degree-level requirements" page: the breadth
 * table (each row → a subject-scoped unit bucket), the communication course
 * options, unit minimums/total, and informational notes (averages, co-op).
 */
export function parseDegreeRequirements(
  detail: DegreeDetailFields,
  pid: string,
  source?: string,
): DegreeParseResult {
  const $ = cheerio.load(detail.degreeRequirements ?? "");
  const warnings: string[] = [];
  const buckets: UnitBucket[] = [];
  const constraints: UnitConstraint[] = [];
  const informational: InformationalItem[] = [];

  // Breadth table: a <table> whose header row mentions "Subject Codes".
  $("table").each((_, table) => {
    const $t = $(table);
    const headers = $t
      .find("th")
      .toArray()
      .map((th) => $(th).text().toLowerCase());
    if (!headers.some((h) => /subject codes/.test(h))) return;
    $t.find("tbody tr").each((_, tr) => {
      const tds = $(tr)
        .find("td")
        .toArray()
        .map((td) => $(td).text().replace(/\s+/g, " ").trim());
      if (tds.length < 3) return;
      const [label, unitsTxt, codesTxt] = tds;
      const um = unitsTxt.match(UNIT_AMOUNT_RE);
      const subjects = (codesTxt.match(/[A-Z]{2,8}/g) ?? []).map((s) =>
        s.toLowerCase(),
      );
      if (!um || subjects.length === 0) return;
      buckets.push({
        id: `breadth-${buckets.length}`,
        label: `Breadth — ${label}`,
        requiredUnits: Number(um[1]),
        scope: { kind: "subject", subjects },
        sourceText: `${label} — ${unitsTxt}: ${codesTxt}`,
      });
    });
  });

  const text = stripHtml(detail.degreeRequirements);

  const ht = text.match(HONOURS_TOTAL_RE);
  const honoursTotal = ht ? Number(ht[1]) : undefined;
  const gt = text.match(GENERAL_TOTAL_RE);
  const generalTotal = gt ? Number(gt[1]) : undefined;

  // Degree-level "min N units at the 200-level" rules are conditional on the
  // major type (e.g. BA: 12.5 for Liberal Studies, 8.0 for all others), so we
  // can't attach them as a single hard constraint without sometimes being
  // wrong. Surface the whole Unit Requirements section verbatim instead.
  const unitReqText = $("h4")
    .filter((_, h) => /unit requirements?/i.test($(h).text()))
    .nextUntil("h4")
    .text()
    .replace(/\s+/g, " ")
    .trim();
  if (unitReqText)
    informational.push({ label: "Unit requirements", text: unitReqText });

  // Communication: course codes near "Communication Requirement".
  let communication: DegreeRequirements["communication"];
  const ci = text.search(/communication requirement/i);
  if (ci >= 0) {
    const window = text.slice(ci, ci + 220);
    const codes = (window.match(/[A-Z]{2,8}\d{3}[A-Z]?/g) ?? [])
      .map((c) => c.toLowerCase())
      .filter((c, i, a) => a.indexOf(c) === i);
    if (codes.length > 0) {
      communication = {
        options: codes,
        sourceText: `${window.split(".")[0].trim()}.`,
      };
    }
  }

  const minAvg = stripHtml(detail.minimumAverageSRequired);
  if (minAvg) informational.push({ label: "Minimum average", text: minAvg });
  const coop = stripHtml(detail.coOperativeRequirementsUndergraduate);
  if (coop)
    informational.push({
      label: "Co-op requirements",
      text: coop.slice(0, 300),
    });

  const degree: DegreeRequirements = {
    kualiId: pid,
    name: detail.title ?? "Degree-level requirements",
    ...(source ? { source } : {}),
    ...(buckets.length > 0 ? { buckets } : {}),
    ...(communication ? { communication } : {}),
    ...(constraints.length > 0 ? { constraints } : {}),
    ...(informational.length > 0 ? { informational } : {}),
  };
  return { degree, honoursTotal, generalTotal, warnings };
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

/**
 * Extract specialization references from a parent program's
 * `specializationsList` HTML. Each anchor looks like
 * `<a href="#/programs/view/{id}">{name}</a>`.
 *
 * The `id` is the 24-char hex identifier the parent uses to reference the
 * spec — the same value the `/program/byId/{catalogId}/{id}` endpoint
 * accepts. The spec's own `pid` field is a different (short-alpha) value
 * and is NOT what we want here.
 */
const SPEC_HREF_PREFIX = "#/programs/view/";
export function parseSpecializationsList(
  html: string | undefined,
): Array<{ id: string; name: string }> {
  if (!html) return [];
  const $ = cheerio.load(html);
  return $(`a[href^="${SPEC_HREF_PREFIX}"]`)
    .toArray()
    .map((el) => ({
      // biome-ignore lint/style/noNonNullAssertion: selector guarantees href starts with the prefix
      id: $(el).attr("href")!.slice(SPEC_HREF_PREFIX.length),
      name: $(el).text().trim(),
    }));
}

/**
 * Build a kebab-case slug for a `Specialization` from its `code` field
 * (e.g. `"HIST-Global Interactions Specialization"` →
 * `"hist-global-interactions"`).
 *
 * Mirrors `buildProgramSlug` minus the credential-prefix stripping: spec
 * codes start with a faculty/program prefix (HIST, CEC, SYDE, CS, ENGL, …)
 * which is part of the spec's identity and must be retained. The trailing
 * `-specialization` suffix is redundant after slugification and is removed
 * for readability.
 */
export function buildSpecializationSlug(code: string): string {
  return rawSlug(code).replace(/-specialization$/, "");
}
