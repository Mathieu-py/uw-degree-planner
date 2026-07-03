/**
 * Build-time parsers for Kuali's requisite HTML (`prerequisites`, `corequisites`,
 * `antirequisites`) → structured snapshot fields, so the runtime never parses
 * HTML. Each requisite is a nested rule tree: group headers ("Complete all/N of
 * the following") wrap `data-test="ruleView-X"` leaves; course refs are
 * `#/courses/view/{id}`, program refs `#/programs/view/{id}`.
 */

import * as cheerio from "cheerio";
import type { PrereqNode } from "../../../lib/prereqs/parse";
import { RULE_RESULT_SELECTOR } from "../util/dom";
import { normalizeCourseCode } from "../util/normalize";

/** A Kuali requisite anchor that links to a course (not a program). */
const COURSE_ANCHOR_SELECTOR = 'a[href*="#/courses/view/"]';
/** A Kuali requisite anchor that links to a program (enrolment restriction). */
const PROGRAM_ANCHOR_SELECTOR = 'a[href*="#/programs/view/"]';

// Plain-text course codes (Kuali renders many antireq rules anchor-less, so
// `<a>` tags alone miss them). Case-SENSITIVE all-caps subject: prose like
// "Fall 2015" never reads as a subject glued to a catalog number; codes do.
const TEXT_COURSE_CODE_RE = /\b([A-Z]{2,8})\s?(\d{3,4}[A-Z]?)\b/g;

/**
 * Every course code named in a Kuali `antirequisites` tree, deduped. Antireqs are
 * a flat conflict set ("credit will not be granted for both"), so the tree's
 * boolean structure is irrelevant — only which courses are named. Program anchors
 * are enrolment restrictions, not antireqs, so they're excluded (course hrefs and
 * text-form codes only — program names carry no catalog number).
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
  // Anchor-less text codes ("…any of the following: AFM204"). Without these a
  // real antireq is dropped, and the empty-is-authoritative contract erases it.
  for (const m of $.root().text().matchAll(TEXT_COURSE_CODE_RE)) {
    const code = normalizeCourseCode(`${m[1]}${m[2]}`);
    if (code) codes.add(code);
  }
  return [...codes];
}

// ── Prerequisite / corequisite rule tree → PrereqNode ──────────────────────
//
// Group-wrapper <li> ("Complete all/1/N of the following" in a <span>, children
// in a nested <ul>) and leaf <li data-test="ruleView-X"> (result <div>). Leaf
// text grammar was enumerated from a catalog sample; see the regexes below.

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
// Graded choice ("…at least 1 of the following: CS136, CS138"). This is a CHOICE
// (OR/countOf), but GRADE_IN_EACH_RE's `\b` branch also matches and would route it
// to requiredCourses (AND); matching this first keeps it an OR.
const GRADE_N_OF_RE =
  /^Earned a minimum grade of .*? in at least (\d+) of the following/i;
const COREQ_N_OF_RE =
  /^Completed or concurrently enrolled in at least (\d+) of the following/i;
const COREQ_ALL_RE = /^Completed or concurrently enrolled in\b/i;
const LEVEL_RE = /^Students must be in level (\d[A-Za-z])/i;
const NOT_OPEN_RE = /^Not (?:open|available) to\b/i;
const ENROLLED_RE = /^Enrolled in\b/i;

/**
 * Parse a Kuali `prerequisites`/`corequisites` rule tree into a {@link PrereqNode}
 * AST, or null when empty. Top-level siblings are conjoined. Unrecognized shapes
 * degrade to a `raw` node → evaluator surfaces "check", never a wrong hard-fail.
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

// A prereq leaf pointing at the coreq list ("Corequisite (see below)"). UW writes
// some prereqs as "… or a corequisite of X"; Kuali stores X in the coreq field and
// leaves only this pointer, which `parseLi` makes a `raw` node — left raw it
// evaluates "uncertain" and swallows its real OR sibling. `spliceCoreqReferences`
// resolves it once both trees are parsed.
const COREQ_REF_RE = /^corequisites?\b.*\bsee\b|^corequisites?\s*$/i;

/** True when a `raw` node's text is a bare "see the corequisite" pointer. */
export function isCoreqReference(text: string): boolean {
  return COREQ_REF_RE.test(text.trim());
}

/**
 * `prereq` with each coreq-pointer `raw` leaf replaced by a `coreqOf` wrapping the
 * parsed coreq tree, e.g. "STAT 220 or (see corequisite)" → "STAT 220 or a
 * corequisite of STAT 230/240". No-op when there's no coreq tree (pointer stays
 * raw → "check") or no pointer.
 *
 * `consumed` reports whether a pointer was spliced. If so, the coreq field was
 * reference material for that (often optional) prereq path, not a standalone
 * corequisite — so the caller must drop the standalone coreq AST, else a
 * student on the prereq's other branch is wrongly badged "Coreq missing"
 * (ACTSC 231).
 */
export function spliceCoreqReferences(
  prereq: PrereqNode | null,
  coreq: PrereqNode | null,
): { node: PrereqNode | null; consumed: boolean } {
  if (!prereq || !coreq) return { node: prereq, consumed: false };
  let consumed = false;
  const visit = (n: PrereqNode): PrereqNode => {
    switch (n.kind) {
      case "raw":
        if (isCoreqReference(n.text)) {
          consumed = true;
          return { kind: "coreqOf", child: coreq };
        }
        return n;
      case "and":
      case "or":
        return { ...n, children: n.children.map(visit) };
      case "countOf":
        return { ...n, children: n.children.map(visit) };
      case "coreqOf":
        return { ...n, child: visit(n.child) };
      default:
        return n;
    }
  };
  return { node: visit(prereq), consumed };
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

  // "At least n of" first: COREQ_ALL_RE is a prefix of the coreq "…at least n of"
  // phrasing, so testing all-of forms first would shadow it and collapse an OR
  // into an AND (e.g. ACTSC 231's "at least 1 of STAT230, STAT240").
  const atLeast =
    COMPLETED_N_OF_RE.exec(text) ??
    COREQ_N_OF_RE.exec(text) ??
    GRADE_N_OF_RE.exec(text);
  if (atLeast) return atLeastNOf(Number(atLeast[1]), codes, text);

  // Course-list leaves (grade thresholds are dropped — the app tracks no grades).
  if (
    COMPLETED_ALL_RE.test(text) ||
    GRADE_IN_EACH_RE.test(text) ||
    COREQ_ALL_RE.test(text)
  ) {
    return requiredCourses(codes, text);
  }

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
 * A program/faculty enrolment restriction → `program` node. Names come from the
 * program-anchors (cleaned to match the eligibility vocab), phrased in the
 * allow-list / negated forms `parseProgramClause` understands. With no anchors
 * (faculty prose), pass raw text through — the clause parser extracts faculty
 * words or returns "unknown" → "check".
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
