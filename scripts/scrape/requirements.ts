import * as cheerio from "cheerio";
import {
  isTermLetter,
  type RuleNode,
  TERM_LETTERS,
  type TermLetter,
} from "../../lib/programs";
import {
  anchorCourseCodes,
  cleanText,
  RULE_RESULT_SELECTOR,
  SECTION_HEADING_SELECTOR,
} from "./dom";
import { CODE_RANGE_RE, normalizeCourseCode, TEXT_CODE_RE } from "./normalize";
import { parseSubjectPool } from "./subjectPool";

export interface ProgramDetailFields {
  requiredCoursesTermByTerm?: string;
  requirements?: string;
  courseRequirementsNoUnits?: string;
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
// Catch-all for prose that fits no recognized rule shape: stray notes,
// conditional preambles, exclusion clauses, and unit-bound elective phrasings
// (handled by `parseElectives`). "Choose" is deliberately absent so future
// Kuali drift on `Choose …` surfaces as warnings.
const DEFERRED_PROSE_RE =
  /^(?:Complete|The following|Note|If\b|Subject concentration)/i;

// A colon-less rule has no clean "prefix" to slice, so we fall back to its
// leading slice — long enough for every `^`-anchored rule regex to match, short
// enough to keep warning messages readable.
const MAX_PREFIX_LEN = 200;

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
 * A recognized rule prefix whose course codes we failed to extract is a SILENT
 * LOSS — a bare `return null` drops a real requirement and the audit reads 100%.
 * Record it as UNVERIFIED (gates the headline below 100%, shown to the student)
 * and warn so the parser miss is visible to developers.
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
  const codes = new Set<string>(anchorCourseCodes($, $result));
  // Fallback for required courses Kuali renders as PLAIN TEXT (absent from UW's
  // course DB — cross-institution "…W" codes like BUS127W, or unlinked INDEV387).
  // Only when nothing was hyperlinked, scan the list after the colon. Bail on a
  // range ("CS340-CS398"): pulling its endpoints as two literals would be wrong,
  // so leave it unextracted (surfaces as unverified).
  if (codes.size === 0) {
    const text = $result.text();
    const colon = text.indexOf(":");
    const list = colon >= 0 ? text.slice(colon + 1) : "";
    if (list && !CODE_RANGE_RE.test(list))
      for (const tok of list.match(TEXT_CODE_RE) ?? []) {
        const code = normalizeCourseCode(tok);
        if (code) codes.add(code);
      }
  }
  return [...codes].sort();
}

/**
 * Wrap children by the prose on a DOM wrapper `<li>`. Only `Complete N of` is
 * structurally meaningful; everything else becomes a plain `all` (the children
 * carry the rule shape). Recognized "Complete all/N of …" text is dropped —
 * `describeRule()` reconstructs it. Non-standard prose (defensive; none in
 * current data) is preserved on the node.
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

function parseTermLetter(headerText: string): TermLetter | null {
  const m = headerText.match(/\b(\d[AB])\b/);
  return m && isTermLetter(m[1]) ? m[1] : null;
}
