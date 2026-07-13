/**
 * Phase A: fetch every Major, parse its rules + electives + unit plan, collect
 * its specialization references. Also the calendar-faculty→Faculty mapping and
 * the post-hoc free-elective fold (run after totals are final). Spec fetches are
 * deferred to Phase B (`./specializations`) so ids can be deduped across parents.
 */
import { countNoun } from "../../../lib/format";
import {
  type CatalogProvenance,
  FACULTIES,
  type Faculty,
  type Program,
} from "../../../lib/programs";
import { applyRuleOverrides } from "../program/overrides";
import {
  buildProgramSlug,
  dropPureUnitBucketElectives,
  parseAdditionalConstraints,
  parseElectives,
  parseProgramRequirements,
  parseSpecializationsList,
  parseUnitPlan,
} from "../programs-parser";
import { API_BASE } from "../sources/kualiCatalog";
import { fetchJson } from "../util/fetch";
import {
  fetchEachPaced,
  type PhaseAResult,
  type ProgramDetail,
  type ProgramListEntry,
  type SpecializationRef,
  VIEW_BASE,
} from "./shared";

/**
 * Map a calendar `facultyCalendarDisplay.name` to one of the six {@link FACULTIES}.
 * Takes the first faculty keyword the (free-text) label names, so a cross-faculty
 * program is filed under its lead faculty ("Faculties of Engineering and
 * Mathematics" → engineering); an affiliated college ("…with Renison University
 * College") falls back to Arts. Null when nothing matches, so the caller omits it.
 */
export function normalizeFaculty(display: string | undefined): Faculty | null {
  if (!display) return null;
  const lower = display.toLowerCase();
  let best: Faculty | null = null;
  let bestIndex = Number.POSITIVE_INFINITY;
  for (const faculty of FACULTIES) {
    const i = lower.indexOf(faculty);
    if (i >= 0 && i < bestIndex) {
      bestIndex = i;
      best = faculty;
    }
  }
  if (best) return best;
  // Affiliated/federated colleges are all Faculty of Arts.
  if (/renison|grebel|jerome|united college|university college/.test(lower)) {
    return "arts";
  }
  return null;
}

/**
 * Phase A — fetch every major, parse its rules + electives, collect its
 * specialization references. Defers spec fetches to Phase B so we can dedup
 * across parents (153 unique ids vs 283 refs in the current calendar).
 */
export async function runPhaseA(
  catalogId: string,
  majors: readonly ProgramListEntry[],
  conflictCounts: ReadonlyMap<string, number>,
  today: string,
  catalog: CatalogProvenance,
  subjectCodeByDescription: ReadonlyMap<string, string>,
): Promise<PhaseAResult> {
  const programs: Record<string, Program> = {};
  const specRefsByParent = new Map<string, SpecializationRef[]>();
  const degreeRefBySlug = new Map<string, { pid: string; name: string }>();
  const freeElectivesBySlug = new Map<string, string[]>();
  const skippedNoData: string[] = [];
  const failed: string[] = [];
  const warnings: string[] = [];
  let withData = 0;

  await fetchEachPaced({
    items: majors,
    label: (p) => buildProgramSlug(p.code, conflictCounts),
    fetcher: (p) =>
      fetchJson<ProgramDetail>(
        `${API_BASE}/program/${catalogId}/${encodeURIComponent(p.pid)}`,
      ),
    onResult: (detail, p) => {
      const slug = buildProgramSlug(p.code, conflictCounts);
      // parseProgramRequirements resets and reads module-level state
      // (namedLists, droppedFreeElectives) within a single SYNCHRONOUS call, so
      // each program's parse is atomic under JS's single thread. Safe here only
      // because fetchEachPaced runs onResult sequentially and this callback
      // never awaits between the parse and its use. Do NOT parallelize the parse
      // (e.g. Promise.all over programs) or make it async — that would interleave
      // two programs' shared state and silently corrupt the audit.
      const result = parseProgramRequirements(detail, slug);
      warnings.push(...result.warnings);
      if (result.kind === "empty") {
        skippedNoData.push(slug);
        return "skipped (no data)";
      }
      if (result.freeElectives?.length)
        freeElectivesBySlug.set(slug, result.freeElectives);

      const electivesResult = parseElectives(detail, slug);
      warnings.push(...electivesResult.warnings);

      // Unit accounting from grad-req prose. Drop pure-unit-bucket electives so a
      // unit requirement isn't also counted as an (untrackable) elective section.
      const planResult = parseUnitPlan(detail.graduationRequirements ?? "");
      const electives = dropPureUnitBucketElectives(electivesResult.electives);
      if (planResult.degreeRef) degreeRefBySlug.set(slug, planResult.degreeRef);

      const electivesField = electives.length > 0 ? { electives } : {};
      const unitPlanField = planResult.unitPlan
        ? { unitPlan: planResult.unitPlan }
        : {};
      // Carry additionalConstraints prose alongside the unit-plan informational
      // items, so rules defined only in prose reach the UI.
      const informational = [
        ...planResult.informational,
        ...parseAdditionalConstraints(detail.additionalConstraints),
      ];
      const informationalField =
        informational.length > 0 ? { informational } : {};
      // Verbatim owed requirements we couldn't structure (unscoped subject
      // pools, unrecognized "Complete …" prose). Surfaced to the student so the
      // audit can't read complete while real requirements were dropped.
      const unverified = [...new Set(result.unverified)];
      const unverifiedField =
        unverified.length > 0 ? { unverifiedRequirements: unverified } : {};
      // Stamp the official subject code when the program's field-of-study name
      // matches a Kuali subject description (e.g. "Applied Mathematics" → AMATH).
      const subjectCode = p.fieldOfStudy?.name
        ? subjectCodeByDescription.get(p.fieldOfStudy.name.toLowerCase())
        : undefined;
      // Home faculty (real attribute, not inferred), for the picker's filter.
      const faculty = normalizeFaculty(detail.facultyCalendarDisplay?.name);
      const base = {
        name: p.title,
        asOf: today,
        source: `${VIEW_BASE}/${encodeURIComponent(p.pid)}`,
        catalog,
        ...(subjectCode ? { subjectCode } : {}),
        ...(faculty ? { faculty } : {}),
      };
      programs[slug] =
        result.kind === "engineering"
          ? {
              kind: "engineering",
              ...base,
              terms: result.terms,
              ...electivesField,
              ...unitPlanField,
              ...informationalField,
              ...unverifiedField,
            }
          : {
              kind: "flexible",
              ...base,
              rules: applyRuleOverrides(slug, result.rules),
              ...electivesField,
              ...unitPlanField,
              ...informationalField,
              ...unverifiedField,
            };
      const specRefs = parseSpecializationsList(detail.specializationsList);
      if (specRefs.length > 0) specRefsByParent.set(slug, specRefs);
      withData++;
      const specSuffix =
        specRefs.length > 0
          ? `, ${countNoun(specRefs.length, "spec ref")}`
          : "";
      return `ok (${result.kind}${specSuffix})`;
    },
    onError: (p) => {
      failed.push(buildProgramSlug(p.code, conflictCounts));
    },
  });

  return {
    programs,
    specRefsByParent,
    degreeRefBySlug,
    freeElectivesBySlug,
    withData,
    skippedNoData,
    failed,
    warnings,
  };
}

/**
 * Re-surface free electives the parser dropped from a program's rule tree
 * (redundant with the unit headline's free remainder) as `unverifiedRequirements`
 * — but ONLY for programs that ended up with no `totalUnits` denominator, where
 * the headline has no free remainder to gate them and the audit could otherwise
 * read 100% with the electives unaccounted. Mutates `programs` in place; merges
 * with any existing entries and dedupes. Call AFTER the total is final (post
 * {@link attachDegreeRequirements}), so a degree-supplied total suppresses them.
 */
export function foldFreeElectivesIntoUnverified(
  programs: Record<string, Program>,
  freeElectivesBySlug: ReadonlyMap<string, string[]>,
): void {
  for (const [slug, freeElectives] of freeElectivesBySlug) {
    const program = programs[slug];
    if (!program || program.unitPlan?.totalUnits != null) continue;
    program.unverifiedRequirements = [
      ...new Set([...(program.unverifiedRequirements ?? []), ...freeElectives]),
    ];
  }
}
