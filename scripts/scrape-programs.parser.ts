import * as cheerio from "cheerio";
import type {
  DegreeRequirements,
  ElectiveCategory,
  InformationalItem,
  RuleNode,
  TermLetter,
  UnitConstraint,
  UnitPlan,
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
      /** Verbatim owed-requirement statements we couldn't structure into a rule. */
      unverified: string[];
    }
  | {
      kind: "flexible";
      rules: RuleNode;
      warnings: string[];
      unverified: string[];
    }
  | { kind: "empty"; warnings: string[]; unverified: string[] };

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

  return { kind: "empty", warnings: [], unverified: [] };
}

function parseEngineering(html: string, programLabel: string): ParseResult {
  const terms = emptyTermsTree();
  const warnings: string[] = [];
  const unverified: string[] = [];
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
      unverified,
    );
    if (root.children.length > 0 || root.kind !== "all") {
      terms[termLetter] = root;
    }
  });

  return { kind: "engineering", terms, warnings, unverified };
}

function parseFlexible(html: string, programLabel: string): ParseResult {
  const allChildren: RuleNode[] = [];
  const warnings: string[] = [];
  const unverified: string[] = [];
  const $ = cheerio.load(html);

  // Flexible programs may have one or more sections; merge them all under
  // one root `all` node. In practice it's a single "Required Courses"
  // section, but we don't depend on that.
  $("section").each((_, section) => {
    const root = parseSectionTree(
      $,
      $(section),
      programLabel,
      warnings,
      unverified,
    );
    if (root.kind === "all") allChildren.push(...root.children);
    else allChildren.push(root);
  });

  if (allChildren.length === 0) {
    return { kind: "empty", warnings, unverified };
  }

  return {
    kind: "flexible",
    rules: { kind: "all", children: allChildren },
    warnings,
    unverified,
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
  unverified: string[],
): RuleNode & { kind: "all" } {
  const topUl = $section
    .children()
    .find("ul")
    .filter((_, ul) => $(ul).children("li").length > 0)
    .first();
  if (topUl.length === 0) return { kind: "all", children: [] };
  const children = walkUl($, topUl, contextLabel, warnings, unverified);
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
  unverified: string[],
): RuleNode[] {
  const items = collectLiSiblings($, $ul);
  const out: RuleNode[] = [];
  for (let i = 0; i < items.length; i++) {
    const parsed = parseLi($, items[i], contextLabel, warnings, unverified);
    if (parsed === null) continue;
    if (parsed.kind === "metaParent") {
      // Consume subsequent siblings as children until end of ul or another
      // metaParent. Skipped (null) siblings are just noise; non-null siblings
      // become children.
      const children: RuleNode[] = [];
      let j = i + 1;
      while (j < items.length) {
        const next = parseLi($, items[j], contextLabel, warnings, unverified);
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
  unverified: string[],
): ParsedLi | null {
  // DOM-nested wrapper: <li>(no data-test) with a <span> + nested <ul>.
  const dataTest = $li.attr("data-test");
  if (!dataTest) {
    const $directChildren = $li.children();
    const $span = $directChildren.filter("span").first();
    const $childUl = $directChildren.filter("ul").first();
    if ($childUl.length === 0) return null;
    const wrapperText = $span.text().replace(/\s+/g, " ").trim();
    const children = walkUl($, $childUl, contextLabel, warnings, unverified);
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

  // We couldn't structure this <li> into a rule. If it states an owed action
  // ("Complete …" — an unscoped subject pool that `parseSubjectPool` rejected
  // for lack of a subject list, or otherwise unrecognized "Complete" prose),
  // surface it verbatim as an UNVERIFIED requirement so the audit doesn't read
  // complete when a real requirement was silently dropped. Non-action prose
  // (Note/If/preambles caught by DEFERRED_PROSE_RE) is genuine noise and stays
  // dropped. A truly unrecognized rule still emits a developer warning.
  if (/^Complete\b/i.test(prefix)) {
    unverified.push(fullText);
    if (!DEFERRED_PROSE_RE.test(prefix))
      warnings.push(`${contextLabel}: unrecognized rule — "${prefix}"`);
    return null;
  }

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
 * Parse a "Complete N …" subject-pool rule into a `subjectPool` node. Returns
 * null if the prose doesn't name an enumerable subject set. Handles:
 *   - "Complete 2 additional STAT courses at the 300-level"
 *   - "Complete 3 additional PMATH courses at the 400-level"
 *   - "Complete 2 additional courses at the 300- or 400-level from: ACTSC, AMATH, CS, …"
 *   - "Complete 3 additional courses from: ACTSC, AMATH, CO, …"
 *   - "Complete 2 math courses from the following subject codes: ACTSC, AMATH, … (excluding CS100, MATH103)"
 *   - "Complete 0.5 unit of BIOL courses at the 100- or 200-level (exclusive of BIOL225 …)"
 *   - "Complete 5.25 units of Science courses from the following subjects: BIOL, CHEM, …"
 *
 * A unit amount ("N units of …") is converted to an approximate course count
 * (units / 0.5) so the count-based audit has a threshold; the unit audit
 * re-weights satisfiers by their real catalog units, so the approximation only
 * affects the count-based fallback. Exclusion clauses (parenthetical or `;`-led)
 * are kept verbatim for display; they don't gate matching.
 */
function parseSubjectPool(fullText: string): RuleNode | null {
  const head = fullText.match(
    /^Complete\s+(\d+(?:\.\d+)?)\s+(additional\s+|units?\s+of\s+)?/i,
  );
  if (!head) return null;
  const amount = Number(head[1]);
  const isUnits = /units?\s+of/i.test(head[2] ?? "");
  let rest = fullText.slice(head[0].length).trim();

  // Pull parenthetical clauses out first ("(excluding CS100, MATH103)",
  // "(exclusive of BIOL225 …)", "(see Additional Constraints)") so they don't
  // confuse level/from parsing; keep them as verbatim exclusion notes.
  const exclusions: string[] = [];
  rest = rest
    .replace(/\(([^)]*)\)/g, (_m, inner: string) => {
      const t = inner.trim();
      if (t) exclusions.push(t);
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();

  // "N units of additional ERS courses" → drop the stray "additional" so the
  // subject code that follows it is found (it sits after "units of", not before).
  rest = rest.replace(/^additional\s+/i, "");

  // Subject descriptor: "STAT courses" (one code) | "ENVS and/or ERS courses"
  // (several codes in the noun) | "math/Science courses" (a noun whose subjects
  // come from a later "from …" clause) | bare "courses".
  let subjectCodes: string[] = [];
  // All-caps codes, optionally joined by "and/or", "and", "or", ",". Matched
  // case-sensitively so prose words ("Science", "additional") aren't mistaken
  // for codes (those fall through to the "from:" clause).
  const codesMatch = rest.match(
    /^([A-Z]{2,8}(?:\s*(?:,|and\/or|and|or)\s*[A-Z]{2,8})*)\s+courses?\b/,
  );
  if (codesMatch) {
    subjectCodes = (codesMatch[1].match(/[A-Z]{2,8}/g) ?? []).map((s) =>
      s.toUpperCase(),
    );
    rest = rest.slice(codesMatch[0].length).trim();
  } else if (/^[A-Za-z]+\s+courses?\b/.test(rest)) {
    // A non-code noun ("Science courses") — subjects must come from "from: …".
    rest = rest.replace(/^[A-Za-z]+\s+courses?\b/, "").trim();
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

  // Optional "from [the following subject codes|the following subjects][:] <list>[; <exclusion>]".
  const fromMatch = rest.match(
    /^from(?:\s+the\s+following\s+subject\s+codes|\s+the\s+following\s+subjects)?:?\s*(.+)$/i,
  );
  if (fromMatch) {
    const parts = fromMatch[1].split(";").map((p) => p.trim());
    const fromSubjects = parts[0]
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter((s) => /^[A-Z]{2,8}$/.test(s));
    if (fromSubjects.length > 0) subjectCodes = fromSubjects;
    for (const p of parts.slice(1)) if (p.length > 0) exclusions.push(p);
  }

  // No enumerable subject codes (a spelled-out noun like "Science courses at the
  // 300-level" with no `from: <CODES>` list) → we won't fabricate a subject set,
  // so the requirement is dropped from the rule tree rather than mis-scoped.
  // Conservative-but-lossy: such a rule is then untracked (no count ring).
  if (subjectCodes.length === 0) return null;

  // A unit-stated pool ("5.25 units of Science courses") has no per-course units
  // at parse time, so `selectCount` approximates the count assuming a 0.5-unit
  // course.
  const selectCount = isUnits ? Math.max(1, Math.round(amount / 0.5)) : amount;
  return {
    kind: "subjectPool",
    selectCount,
    subjectCodes,
    ...(minLevel !== undefined ? { minLevel } : {}),
    ...(maxLevel !== undefined ? { maxLevel } : {}),
    ...(exclusions.length > 0 ? { exclusions } : {}),
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

/* ----------------------- unit-accounting parser ------------------------- */

// A degree total ("Complete a total of 20.0 units:"). Some programs qualify it
// as "academic units" (e.g. engineering: "Complete a total of 21.25 academic
// units (excluding COOP, PD, WKRPT)"), so the qualifier is optional. The
// negative lookahead rejects "Complete a total of 8.0 units of HIST" — that's a
// subject requirement, not the degree total (which lives on the degree page).
const TOTAL_UNITS_RE =
  /complete a total of\s+(\d+(?:\.\d+)?)\s*(?:academic\s+)?units\b(?!\s+of\b)/i;
// "minimum of 14.5 units must be at the 200-level or above"
const LEVEL_CONSTRAINT_RE =
  /(\d+(?:\.\d+)?)\s*units?\b[^.]*?\bat the\s+(\d)00-level\s+or above/i;
const FAILED_UNITS_RE = /maximum of\s+(\d+(?:\.\d+)?)\s*(?:failed )?units/i;

export interface UnitPlanResult {
  unitPlan: UnitPlan | null;
  informational: InformationalItem[];
  /** Referenced "Bachelor of X degree-level requirements" Kuali pid, if any. */
  degreeRef: { pid: string; name: string } | null;
  warnings: string[];
}

/**
 * Parse the `graduationRequirements` prose into the surviving unit data: the
 * degree total (gauge denominator) and level-minimum constraints surfaced as
 * verbatim notes, plus informational notes (failed-unit caps, communication
 * prose) and the degree-level reference. Subject/elective unit *buckets* are no
 * longer extracted — the count audit and the soft units gauge cover the degree.
 */
export function parseUnitPlan(
  html: string,
  _programLabel = "(unknown)",
): UnitPlanResult {
  const $ = cheerio.load(html);
  const warnings: string[] = [];
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
  // a sub-list, so read the total from the whole document text.
  const totalMatch = $.root().text().match(TOTAL_UNITS_RE);
  const totalUnits = totalMatch ? Number(totalMatch[1]) : undefined;

  // Walk every leaf <li>; surface level-minimum rules as notes, failed-unit
  // caps as informational. Other unit prose ("N units of <subject>") is ignored.
  $("li")
    .filter((_, li) => $(li).find("ul, ol").length === 0)
    .each((_, li) => {
      const text = $(li).text().replace(/\s+/g, " ").trim();
      if (!text) return;

      if (LEVEL_CONSTRAINT_RE.test(text)) {
        constraints.push({ label: text, sourceText: text });
        return;
      }

      if (FAILED_UNITS_RE.test(text)) {
        informational.push({ label: "Failed units", text });
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

  const unitPlan: UnitPlan | null =
    constraints.length > 0 || totalUnits !== undefined
      ? {
          ...(totalUnits !== undefined ? { totalUnits } : {}),
          ...(constraints.length > 0 ? { constraints } : {}),
        }
      : null;

  return { unitPlan, informational, degreeRef, warnings };
}

/**
 * Drop elective entries that have nothing trackable to render: a "pure unit
 * bucket" ("5.5 units of elective courses" — a unit amount with no approved-course
 * list and no finite count) can't be shown as a count-based section, so it's
 * filtered out. Everything else (approved lists, finite count-based lists) stays.
 */
export function reconcileUnitsAndElectives(
  unitPlan: UnitPlan | null,
  electives: ElectiveCategory[],
): {
  unitPlan: UnitPlan | null;
  electives: ElectiveCategory[];
} {
  const isPureUnitBucket = (e: ElectiveCategory) =>
    e.unitRequirement != null &&
    !(e.approvedCourses && e.approvedCourses.length > 0) &&
    e.requiredCount == null;

  return {
    unitPlan,
    electives: electives.filter((e) => !isPureUnitBucket(e)),
  };
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
  /** Three-year general (or plain "general degree") total, for `3g-` majors. */
  generalTotal?: number;
  /** Four-year general total, for `4g-` majors (distinct from three-year!). */
  fourYearTotal?: number;
  warnings: string[];
}

// Faculties phrase the total as "Complete a total of N units" (Arts) or
// "Complete a minimum of N units" (Math), PER DEGREE TYPE — three-year general,
// four-year general, and honours can each be different (15.0 vs 20.0 vs 20.0),
// so they're matched separately and picked by the program's degree type.
const HONOURS_TOTAL_RE =
  /honours[^.]*?(?:total|minimum) of\s+(\d+(?:\.\d+)?)\s*units/i;
const GENERAL_TOTAL_RE =
  /(?:three-year general|general degree)[^.]*?(?:total|minimum) of\s+(\d+(?:\.\d+)?)\s*units/i;
const FOUR_YEAR_TOTAL_RE =
  /four-year general[^.]*?(?:total|minimum) of\s+(\d+(?:\.\d+)?)\s*units/i;
// Some degree pages state a single, unqualified total (e.g. the Bachelor of
// Computer Science page: "Complete a minimum of 20.0 units, exceptions noted
// below.") with no three-year/four-year/honours split. The lookahead rejects a
// level constraint ("…units at the 200-level") and a subject bucket
// ("…units of HIST"); "Minimum of 26.0 units" (double-degree variant) lacks the
// "Complete a" lead-in and is skipped. Used only as a fallback when none of the
// degree-type-qualified totals match.
const GENERIC_TOTAL_RE =
  /complete a (?:total|minimum) of\s+(\d+(?:\.\d+)?)\s*units\b(?!\s+(?:of\b|at\b))/i;
const UNIT_AMOUNT_RE = /(\d+(?:\.\d+)?)\s*units?/i;

function stripHtml(html: string | undefined): string {
  return (html ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse a faculty "Bachelor of X degree-level requirements" page: the breadth
 * table (each row → a verbatim constraint note), the communication course
 * options, unit total, and informational notes (averages, co-op).
 */
export function parseDegreeRequirements(
  detail: DegreeDetailFields,
  pid: string,
  source?: string,
): DegreeParseResult {
  const $ = cheerio.load(detail.degreeRequirements ?? "");
  const warnings: string[] = [];
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
      // Breadth is a real degree requirement, surfaced verbatim as a note for the
      // student to verify (we no longer evaluate its subject scope structurally).
      constraints.push({
        label: `Breadth — ${label}`,
        sourceText: `${label} — ${unitsTxt}: ${codesTxt}`,
      });
    });
  });

  const text = stripHtml(detail.degreeRequirements);

  const ht = text.match(HONOURS_TOTAL_RE);
  const gt = text.match(GENERAL_TOTAL_RE);
  const generalTotal = gt ? Number(gt[1]) : undefined;
  const ft = text.match(FOUR_YEAR_TOTAL_RE);
  const fourYearTotal = ft ? Number(ft[1]) : undefined;
  // A page with no degree-type-qualified total states a single degree total
  // (e.g. BCS): adopt it as the honours total so it propagates to its programs.
  let honoursTotal = ht ? Number(ht[1]) : undefined;
  if (honoursTotal == null && generalTotal == null && fourYearTotal == null) {
    const g = text.match(GENERIC_TOTAL_RE);
    if (g) honoursTotal = Number(g[1]);
  }
  // The verbatim "Unit Requirements" prose lists every degree type at once,
  // which is noise on a specific plan — we extract the right total per degree
  // type above, so we don't surface that blob.

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
  // The co-op field appends a Study/Work Sequences chart (an HTML <table> under
  // a "Legend for Study/Work Sequence(s) Chart" heading) that flattens into
  // meaningless prose. Cut at whichever comes first — the legend heading or the
  // table — and keep the requirement + constraints prose before it, in full.
  // (The old 300-char cap cut real PD-course rules off mid-word.)
  const coopHtml = detail.coOperativeRequirementsUndergraduate ?? "";
  const coop = stripHtml(
    coopHtml.split(/<table|Legend for Study\/Work Sequences? Chart/i)[0],
  ).trim();
  if (coop) informational.push({ label: "Co-op requirements", text: coop });

  const degree: DegreeRequirements = {
    kualiId: pid,
    name: detail.title ?? "Degree-level requirements",
    ...(source ? { source } : {}),
    ...(communication ? { communication } : {}),
    ...(constraints.length > 0 ? { constraints } : {}),
    ...(informational.length > 0 ? { informational } : {}),
  };
  return { degree, honoursTotal, generalTotal, fourYearTotal, warnings };
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
