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
import type { PrereqNode } from "../../lib/prereqs/parse";
import { RULE_RESULT_SELECTOR } from "./dom";
import { normalizeCourseCode } from "./normalize";

/** A Kuali requisite anchor that links to a course (not a program). */
const COURSE_ANCHOR_SELECTOR = 'a[href*="#/courses/view/"]';
/** A Kuali requisite anchor that links to a program (enrolment restriction). */
const PROGRAM_ANCHOR_SELECTOR = 'a[href*="#/programs/view/"]';

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

// ── Prerequisite / corequisite rule tree → PrereqNode ──────────────────────
//
// Kuali nests rules as: group-wrapper <li> ("Complete all/1/N of the following"
// in a <span>, children in a nested <ul>) and leaf <li data-test="ruleView-X">
// (a result <div> stating the requirement). The grammar of leaf result text was
// enumerated from a catalog sample; see the regexes below.

const clean = (s: string): string => s.replace(/\s+/g, " ").trim();

// Group-wrapper prose (on the <span> of a non-leaf <li>).
const GROUP_ALL_RE = /^Complete all (?:of the|the) following/i;
const GROUP_N_OF_RE = /^Complete (\d+) of (?:the )?following/i;

// Leaf result-text prefixes (matched against the full, colon-included text).
const COMPLETED_ALL_RE = /^Must have completed the following/i;
const COMPLETED_N_OF_RE =
  /^Must have completed at least (\d+) of the following/i;
const GRADE_IN_EACH_RE =
  /^Earned a minimum grade of .*? in (?:each of the following|\b)/i;
const COREQ_N_OF_RE =
  /^Completed or concurrently enrolled in at least (\d+) of the following/i;
const COREQ_ALL_RE = /^Completed or concurrently enrolled in\b/i;
const LEVEL_RE = /^Students must be in level (\d[A-Za-z])/i;
const NOT_OPEN_RE = /^Not (?:open|available) to\b/i;
const ENROLLED_RE = /^Enrolled in\b/i;

/**
 * Parse a Kuali `prerequisites` or `corequisites` rule-tree HTML string into a
 * {@link PrereqNode} AST, or null when empty/unparseable. Top-level siblings are
 * conjoined (all must hold). Anything whose shape isn't recognized degrades to a
 * `raw` node, which the evaluator surfaces as "check" — never a wrong hard-fail.
 */
export function parseKualiRequisite(
  html: string | null | undefined,
): PrereqNode | null {
  if (!html || html.trim() === "") return null;
  const $ = cheerio.load(html);
  const $topUl = $("ul")
    .filter((_, ul) => collectLis($, $(ul)).length > 0)
    .first();
  if ($topUl.length === 0) return null;
  return combine(walkUl($, $topUl), "and");
}

/** Collapse a child list into a single node (or the lone child, or null). */
function combine(
  children: PrereqNode[],
  kind: "and" | "or",
): PrereqNode | null {
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return { kind, children };
}

/**
 * A <ul>'s logical <li> children, looking one level into <div> spacers Kuali
 * wraps around subsets (the `rules_groupHeader` divs).
 */
function collectLis(
  $: cheerio.CheerioAPI,
  $ul: ReturnType<cheerio.CheerioAPI>,
): ReturnType<cheerio.CheerioAPI>[] {
  const out: ReturnType<cheerio.CheerioAPI>[] = [];
  $ul.children().each((_, child) => {
    if (child.type !== "tag") return;
    if (child.name === "li") out.push($(child));
    else if (child.name === "div")
      $(child)
        .children("li")
        .each((_, li) => {
          out.push($(li));
        });
  });
  return out;
}

function walkUl(
  $: cheerio.CheerioAPI,
  $ul: ReturnType<cheerio.CheerioAPI>,
): PrereqNode[] {
  const out: PrereqNode[] = [];
  for (const $li of collectLis($, $ul)) {
    const node = parseLi($, $li);
    if (node) out.push(node);
  }
  return out;
}

function parseLi(
  $: cheerio.CheerioAPI,
  $li: ReturnType<cheerio.CheerioAPI>,
): PrereqNode | null {
  // Group wrapper: <li> with no data-test, a <span> label + nested <ul>.
  if (!$li.attr("data-test")) {
    const $childUl = $li.children("ul").first();
    if ($childUl.length === 0) return null;
    const children = walkUl($, $childUl);
    if (children.length === 0) return null;
    const label = clean($li.children("span").first().text());
    const nOf = GROUP_N_OF_RE.exec(label);
    if (nOf) return countNode(Number(nOf[1]), children);
    if (GROUP_ALL_RE.test(label)) return combine(children, "and");
    // Unrecognized wrapper prose → default to conjunction (the children carry
    // the real structure); preserves correctness without inventing a rule.
    return combine(children, "and");
  }

  // Leaf rule: <li data-test="ruleView-X"> with a result <div> inside.
  const $result = $li.children(RULE_RESULT_SELECTOR).first();
  if ($result.length === 0) return null;
  const text = clean($result.text());
  const codes = courseCodes($, $result);

  // Course-list leaves (grade thresholds are dropped — the app tracks no grades).
  if (
    COMPLETED_ALL_RE.test(text) ||
    GRADE_IN_EACH_RE.test(text) ||
    COREQ_ALL_RE.test(text)
  ) {
    return requiredCourses(codes, text);
  }
  const atLeast = COMPLETED_N_OF_RE.exec(text) ?? COREQ_N_OF_RE.exec(text);
  if (atLeast) return atLeastNOf(Number(atLeast[1]), codes, text);

  // Level gate.
  const level = LEVEL_RE.exec(text);
  if (level) return { kind: "level", minLevel: level[1].toUpperCase() };

  // Program / faculty enrolment restriction.
  if (NOT_OPEN_RE.test(text)) return programNode($, $result, text, true);
  if (ENROLLED_RE.test(text)) return programNode($, $result, text, false);

  // Milestones (WHMIS, etc.) and anything unrecognized → "check".
  return { kind: "raw", text };
}

/** A set of courses that must ALL be completed → `course` or `and` of courses. */
function requiredCourses(codes: string[], rawText: string): PrereqNode {
  if (codes.length === 0) return { kind: "raw", text: rawText };
  if (codes.length === 1) return { kind: "course", code: codes[0] };
  return { kind: "and", children: codes.map(courseLeaf) };
}

/** "At least n of these courses" → course / or / countOf / and (n ≥ all). */
function atLeastNOf(n: number, codes: string[], rawText: string): PrereqNode {
  if (codes.length === 0) return { kind: "raw", text: rawText };
  if (codes.length === 1) return { kind: "course", code: codes[0] };
  if (n <= 1) return { kind: "or", children: codes.map(courseLeaf) };
  if (n >= codes.length)
    return { kind: "and", children: codes.map(courseLeaf) };
  return countNode(n, codes.map(courseLeaf));
}

/** Build a countOf, narrowing to and/or at the n=all / n≤1 boundaries. */
function countNode(n: number, children: PrereqNode[]): PrereqNode {
  if (children.length === 0) return { kind: "raw", text: "" };
  if (n <= 1) return combine(children, "or") as PrereqNode;
  if (n >= children.length) return combine(children, "and") as PrereqNode;
  return { kind: "countOf", n, children };
}

const courseLeaf = (code: string): PrereqNode => ({ kind: "course", code });

/** Distinct course codes from the course-anchors inside a result block. */
function courseCodes(
  $: cheerio.CheerioAPI,
  $result: ReturnType<cheerio.CheerioAPI>,
): string[] {
  const codes = new Set<string>();
  $result.find(COURSE_ANCHOR_SELECTOR).each((_, a) => {
    const code = normalizeCourseCode($(a).text());
    if (code) codes.add(code);
  });
  return [...codes];
}

/**
 * A program/faculty enrolment restriction → `program` node. Program names come
 * from the program-anchors; strip Kuali's plan-type prefix ("H-", "3G-") and the
 * degree-suffix parenthetical so they match the eligibility vocabulary, then
 * phrase the clause in the allow-list / negated forms `parseProgramClause`
 * understands. With no program anchors (faculty prose like "Enrolled in a
 * program offered by Faculty of Engineering"), pass the raw text through — the
 * clause parser extracts faculty words, or returns "unknown" → "check".
 */
function programNode(
  $: cheerio.CheerioAPI,
  $result: ReturnType<cheerio.CheerioAPI>,
  rawText: string,
  negated: boolean,
): PrereqNode {
  const names = new Set<string>();
  $result.find(PROGRAM_ANCHOR_SELECTOR).each((_, a) => {
    const name = cleanProgramName($(a).text());
    if (name) names.add(name);
  });
  if (names.size === 0) return { kind: "program", clause: rawText };
  const joined = [...names].join(" or ");
  return {
    kind: "program",
    clause: negated ? `Not open to ${joined}` : `${joined} students only`,
  };
}

/** "H-Computer Science (BCS)" → "Computer Science" (matches the program vocab). */
function cleanProgramName(raw: string): string {
  return clean(raw)
    .replace(/^[A-Za-z0-9]{1,3}-/, "") // plan-type prefix: H-, 3G-, 4G-, NG-
    .replace(/\s*\([^)]*\)\s*$/, "") // degree-type parenthetical
    .trim();
}
