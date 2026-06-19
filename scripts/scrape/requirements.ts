import * as cheerio from "cheerio";
import {
  isTermLetter,
  type RuleNode,
  TERM_LETTERS,
  type TermLetter,
} from "../../lib/programs";
import { catalogCodesInRange } from "./catalog";
import { WORD_NUMBERS } from "./counts";
import {
  anchorCourseCodes,
  cleanText,
  RULE_RESULT_SELECTOR,
  SECTION_HEADING_SELECTOR,
} from "./dom";
import { buildNamedListIndex, normalizeListName } from "./electives";
import {
  CODE_RANGE_RE_G,
  normalizeCourseCode,
  parseCodeRange,
  TEXT_CODE_RE,
} from "./normalize";
import { parseChooseAnyPool, parseSubjectPool } from "./subjectPool";

export interface ProgramDetailFields {
  requiredCoursesTermByTerm?: string;
  requirements?: string;
  courseRequirementsNoUnits?: string;
  /** Structured named lists ("Technical Electives List") joined by name (#117 D). */
  courseListsNew?: string;
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
// Prose that fits no rule shape (notes, preambles, unit-bound electives handled
// by parseElectives). "Choose" is omitted so Kuali drift on it surfaces as a warning.
const DEFERRED_PROSE_RE =
  /^(?:Complete|The following|Note|If\b|Subject concentration)/i;

// Fallback prefix slice for a colon-less rule: long enough for every ^-anchored
// rule regex, short enough to keep warnings readable.
const MAX_PREFIX_LEN = 200;

// This program's `courseListsNew` keyed by normalized heading; reset per
// parseProgramRequirements call (synchronous, single-program → reentrancy-safe).
// Joins a rule's "from List N" reference to its courses. See #117 (bucket D).
let namedLists = new Map<string, string[]>();

// "List A, B, C, or D" / "List 1" — captures the enumeration after "List".
const LIST_ENUM_RE =
  /\blist\s+([A-Za-z0-9](?:\s*,\s*(?:or\s+)?[A-Za-z0-9]|\s+or\s+[A-Za-z0-9])*)/i;
// "from the Technical Electives lists" / "from the Approved Courses list".
const NAMED_LIST_RE = /\bfrom\s+(?:the\s+)?([^.;:]+?)\s+lists?\b/i;
// Leading count: "Complete 1 additional course…", "four courses…", "Complete a
// total of 7…". Stops the count from being mistaken for a trailing "List 1".
const LEADING_COUNT_RE =
  /\b(?:complete\s+(?:a\s+total\s+of\s+)?)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:additional\s+)?(?:courses?|of\b)/i;

/**
 * Resolve a rule referencing named `courseListsNew` lists ("from the Technical
 * Electives lists", "List A, B, C, or D") to the union of their course codes.
 * Tries a "List X[, Y…]" enumeration first, then a "from the <Name> list"
 * reference. Null when no known list matches — the rule stays unverified (e.g. a
 * list defined only in additionalConstraints prose). See #117 (bucket D).
 */
function resolveNamedList(fullText: string): string[] | null {
  if (namedLists.size === 0) return null;
  const keys: string[] = [];

  const enumMatch = LIST_ENUM_RE.exec(fullText);
  if (enumMatch)
    for (const tok of enumMatch[1].split(/[,\s]+|\bor\b/i))
      if (tok.trim()) keys.push(normalizeListName(`list ${tok.trim()}`));

  const namedMatch = NAMED_LIST_RE.exec(fullText);
  if (namedMatch) keys.push(normalizeListName(namedMatch[1]));

  const courses = new Set<string>();
  for (const key of keys) {
    const exact = namedLists.get(key);
    if (exact) {
      for (const c of exact) courses.add(c);
      continue;
    }
    // Contains-match for multi-word headings ("Technical Electives" vs a rule's
    // "Technical Electives for Option X"). Length guard keeps single letters/
    // digits ("List A"/"List 1") exact-only — else "a" matches any heading.
    for (const [name, list] of namedLists)
      if (key.length >= 3 && (name.includes(key) || key.includes(name)))
        for (const c of list) courses.add(c);
  }
  return courses.size > 0 ? [...courses].sort() : null;
}

/** Leading requirement count ("Complete 1 …", "four courses …"); null if none. */
function leadingCount(fullText: string): number | null {
  const m = LEADING_COUNT_RE.exec(fullText);
  if (!m) return null;
  return WORD_NUMBERS[m[1].toLowerCase()] ?? Number(m[1]);
}

/**
 * Parse a Kuali program detail into a discriminated `ParseResult`.
 *
 * Field-selection precedence (first non-empty wins):
 *   1. `requiredCoursesTermByTerm` → engineering (per-term trees)
 *   2. `requirements`              → flexible (single tree)
 *   3. `courseRequirementsNoUnits` → flexible (single tree)
 *
 * 2 and 3 are HTML-equivalent — Kuali emits the same shape into one or the
 * other depending on whether unit counts are tracked.
 */
export function parseProgramRequirements(
  detail: ProgramDetailFields,
  programLabel = "(unknown)",
): ParseResult {
  // Reset per program so a "from List N" rule can be joined to THIS program's
  // named lists (and never leaks the previous program's).
  namedLists = buildNamedListIndex(detail.courseListsNew);

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
    const header = cleanText($section.find(SECTION_HEADING_SELECTOR).text());
    const termLetter = parseTermLetter(header);
    if (!termLetter) return;

    const root = parseSectionTree(
      $,
      $section,
      `${programLabel} ${termLetter}`,
      warnings,
      unverified,
    );
    if (root.children.length > 0) {
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
    // parseSectionTree always returns an `all` node — flatten its children in.
    allChildren.push(...root.children);
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
 * Build a rule tree from a `<section>`, walking its top-level `<ul>`
 * hierarchically. Two parent-child shapes both produce a tree:
 *   - DOM-nested: `<li><span>Complete all…</span><ul>…children…</ul></li>`
 *   - Sibling-implied: a leaf `<li>` with meta-prose ("Complete N courses from
 *     the following choices:") consumes subsequent same-level siblings.
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
      // Resume at the sibling that stopped us; the outer loop re-parses it.
      // Safe: parseLi only stops on a metaParent, whose branch has no side
      // effects.
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

/**
 * A recognized rule whose codes we couldn't extract is a silent loss (a bare
 * `return null` would let the audit read 100%). Record it as unverified and warn.
 */
function recordUnextracted(
  fullText: string,
  prefix: string,
  contextLabel: string,
  warnings: string[],
  unverified: string[],
): null {
  unverified.push(fullText);
  warnings.push(
    `${contextLabel}: recognized rule but extracted no course codes — "${prefix}"`,
  );
  return null;
}

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
    const wrapperText = cleanText($span.text());
    const children = walkUl($, $childUl, contextLabel, warnings, unverified);
    if (children.length === 0) return null;
    const wrapper = wrapWithProse(wrapperText, children);
    return { kind: "node", node: wrapper };
  }

  // Leaf rule: <li data-test="ruleView-X"> with <div data-test="ruleView-X-result"> inside.
  const $result = $li.children(RULE_RESULT_SELECTOR).first();
  if ($result.length === 0) return null;

  const fullText = cleanText($result.text());
  const colonIdx = fullText.indexOf(":");
  const prefix =
    colonIdx >= 0
      ? fullText.slice(0, colonIdx).trim()
      : fullText.slice(0, MAX_PREFIX_LEN);

  const codes = collectCourseCodes($, $result);

  // A rule referencing a `courseListsNew` list by name extracts no codes itself;
  // join the list's courses before the branches below record it unverified. A
  // leading count → `pick N`, else an open `pick`. See #117 (bucket D).
  if (codes.length === 0) {
    const listCourses = resolveNamedList(fullText);
    if (listCourses) {
      const n = leadingCount(fullText);
      return {
        kind: "node",
        node:
          n !== null
            ? {
                kind: "pick",
                selectMin: n,
                selectMax: n,
                children: [{ kind: "courses", courses: listCourses }],
              }
            : {
                kind: "pick",
                children: [{ kind: "courses", courses: listCourses }],
              },
      };
    }
  }

  if (COMPLETE_ALL_RE.test(prefix)) {
    if (codes.length === 0)
      return recordUnextracted(
        fullText,
        prefix,
        contextLabel,
        warnings,
        unverified,
      );
    return { kind: "node", node: { kind: "courses", courses: codes } };
  }

  const nOf = COMPLETE_N_OF_RE.exec(prefix);
  if (nOf) {
    if (codes.length === 0)
      return recordUnextracted(
        fullText,
        prefix,
        contextLabel,
        warnings,
        unverified,
      );
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
    if (codes.length === 0) {
      // No literal codes — try the pool half ("any CS course at the 600-/700-
      // level") before giving up. See #117 (bucket C).
      const pool = parseChooseAnyPool(fullText);
      if (pool) return { kind: "node", node: pool };
      return recordUnextracted(
        fullText,
        prefix,
        contextLabel,
        warnings,
        unverified,
      );
    }
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
    if (codes.length === 0)
      return recordUnextracted(
        fullText,
        prefix,
        contextLabel,
        warnings,
        unverified,
      );
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
    // An exclusion with no extractable codes excludes nothing, so it's not an
    // owed requirement (don't gate the audit on it) — but warn, since a parse
    // miss here means a course that SHOULD be barred might still be credited.
    if (codes.length === 0) {
      warnings.push(
        `${contextLabel}: exclusion rule but extracted no course codes — "${prefix}"`,
      );
      return null;
    }
    return {
      kind: "node",
      node: { kind: "excluded", courses: codes },
    };
  }

  // Subject-pool prose. Try against the full text (the rule may have colons).
  const subjectPool = parseSubjectPool(fullText);
  if (subjectPool) return { kind: "node", node: subjectPool };

  // Unstructurable <li>. If it states an owed action ("Complete …" — an
  // unscoped subject pool, or unrecognized "Complete" prose), surface it
  // verbatim as UNVERIFIED so the audit doesn't read complete. Owed-but-
  // unstructured, not a parser miss, so no developer warning.
  if (/^Complete\b/i.test(prefix)) {
    unverified.push(fullText);
    return null;
  }

  // Non-action prose (Note/If/preambles caught by DEFERRED_PROSE_RE) is genuine
  // noise and stays dropped silently. Anything else is a truly unrecognized rule
  // shape — warn so future Kuali drift surfaces to developers.
  if (DEFERRED_PROSE_RE.test(prefix)) return null;

  warnings.push(`${contextLabel}: unrecognized rule — "${prefix}"`);
  return null;
}

function collectCourseCodes(
  $: cheerio.CheerioAPI,
  $result: ReturnType<cheerio.CheerioAPI>,
): string[] {
  const anchored = anchorCourseCodes($, $result);
  const codes = new Set<string>(anchored);
  const text = $result.text();
  const colon = text.indexOf(":");
  const list = colon >= 0 ? text.slice(colon + 1) : "";
  if (list) {
    // Ranges ("CS440-CS498") are never hyperlinked, so expand them even when the
    // rule also has anchored literals — a plain-text range in a mixed list isn't
    // lost. Inclusive bands, real codes only (never synthesized). See #117 (C).
    for (const m of list.matchAll(CODE_RANGE_RE_G)) {
      const range = parseCodeRange(m[0]);
      if (range) for (const code of catalogCodesInRange(range)) codes.add(code);
    }
    // Literal plain-text codes only as a fallback when nothing was hyperlinked
    // (Kuali "…W" codes, unlinked INDEV387), so prose codes don't leak into an
    // already-anchored rule.
    if (anchored.length === 0) {
      const remainder = list.replace(CODE_RANGE_RE_G, " ");
      for (const tok of remainder.match(TEXT_CODE_RE) ?? []) {
        const code = normalizeCourseCode(tok);
        if (code) codes.add(code);
      }
    }
  }
  return [...codes].sort();
}

/**
 * Wrap children by a DOM wrapper `<li>`'s prose. Only "Complete N of" is
 * structural; recognized "Complete all/N of …" text is dropped (describeRule
 * reconstructs it). Non-standard prose is preserved on the node.
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
  // Keep non-standard wrapper prose verbatim — even on the single-child fast
  // path, where unwrapping would otherwise drop it.
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

function parseTermLetter(headerText: string): TermLetter | null {
  const m = headerText.match(/\b(\d[AB])\b/);
  return m && isTermLetter(m[1]) ? m[1] : null;
}
