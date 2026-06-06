import * as cheerio from "cheerio";
import type {
  ElectiveCategory,
  InformationalItem,
  UnitConstraint,
  UnitPlan,
} from "../../lib/programs";

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
