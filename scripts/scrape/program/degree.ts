import * as cheerio from "cheerio";
import type {
  DegreeRequirements,
  InformationalItem,
  UnitConstraint,
} from "../../../lib/programs";
import { cleanText } from "../util/dom";
import { extractSubjectCodes } from "../util/normalize";

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

// Faculties state the total PER DEGREE TYPE — three-year, four-year, and
// honours can each differ — so each is matched separately and picked by type.
const HONOURS_TOTAL_RE =
  /honours[^.]*?(?:total|minimum) of\s+(\d+(?:\.\d+)?)\s*units/i;
const GENERAL_TOTAL_RE =
  /(?:three-year general|general degree)[^.]*?(?:total|minimum) of\s+(\d+(?:\.\d+)?)\s*units/i;
const FOUR_YEAR_TOTAL_RE =
  /four-year general[^.]*?(?:total|minimum) of\s+(\d+(?:\.\d+)?)\s*units/i;
// Fallback for a single unqualified total (e.g. BCS "Complete a minimum of 20.0
// units…"), used only when no degree-type-qualified total matches. The
// lookahead rejects level/subject buckets; the "Complete a" lead-in skips the
// double-degree "Minimum of 26.0 units".
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
        .map((td) => cleanText($(td).text()));
      if (tds.length < 3) return;
      const [label, unitsTxt, codesTxt] = tds;
      const um = unitsTxt.match(UNIT_AMOUNT_RE);
      const subjects = extractSubjectCodes(codesTxt);
      if (!um || subjects.length === 0) return;
      // Breadth surfaced verbatim as a note (scope isn't evaluated structurally).
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
  // No degree-type-qualified total: adopt the single total as honours so it
  // propagates to the program's majors.
  let honoursTotal = ht ? Number(ht[1]) : undefined;
  if (honoursTotal == null && generalTotal == null && fourYearTotal == null) {
    const g = text.match(GENERIC_TOTAL_RE);
    if (g) honoursTotal = Number(g[1]);
  }
  // The verbatim "Unit Requirements" prose lists every degree type at once —
  // noise on a specific plan, so we don't surface it.

  // Communication: course codes near "Communication Requirement".
  let communication: DegreeRequirements["communication"];
  const ci = text.search(/communication requirement/i);
  if (ci >= 0) {
    const window = text.slice(ci, ci + 220);
    const codes = (window.match(/[A-Z]{2,8}\d{3,4}[A-Z]?/g) ?? [])
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
  // The co-op field appends a Study/Work Sequences chart that flattens into
  // noise. Cut at whichever comes first (legend heading or table), keeping the
  // requirement prose before it in full.
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
