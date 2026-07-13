/**
 * Pipeline orchestration: discover the catalog, run Phase A (programs) → Phase B
 * (specializations) → degrees, fold in late data, stamp term spans, and write
 * the output. Invoked by `scripts/scrape-programs.ts`.
 */
import path from "node:path";
import { deriveNumberOfTerms } from "../program/termSpan";
import { buildConflictCounts } from "../programs-parser";
import {
  API_BASE,
  discoverCatalog,
  fetchSubjectCodeMap,
} from "../sources/kualiCatalog";
import { fetchJson } from "../util/fetch";
import { attachDegreeRequirements, runPhaseDegrees } from "./degrees";
import { reportList, writeOutput } from "./output";
import { foldFreeElectivesIntoUnverified, runPhaseA } from "./programs";
import type { ProgramListEntry } from "./shared";
import { attachSpecsToParents, runPhaseB } from "./specializations";

export async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const catalog = await discoverCatalog();
  const catalogId = catalog.id;
  console.log(
    `Catalog ${catalogId}${catalog.year ? ` (${catalog.year})` : ""}${catalog.title ? ` — ${catalog.title}` : ""}`,
  );

  process.stdout.write("Fetching program list... ");
  const list = await fetchJson<ProgramListEntry[]>(
    `${API_BASE}/programs/${catalogId}?q=`,
  );
  const majors = list.filter(
    (p) => p.undergraduateCredentialType?.name === "Major",
  );
  console.log(`${list.length} entries (${majors.length} Majors)`);

  // Subject-code enrichment is optional polish — a fetch failure here must not
  // abort the whole scrape, so fall back to an empty map and warn.
  let subjectCodeByDescription = new Map<string, string>();
  try {
    process.stdout.write("Fetching subject codes... ");
    subjectCodeByDescription = await fetchSubjectCodeMap(catalogId);
    console.log(`${subjectCodeByDescription.size} subjects`);
  } catch (err) {
    console.warn("\nsubject-code enrichment skipped:", err);
  }

  const conflictCounts = buildConflictCounts(majors.map((p) => p.code));

  const phaseA = await runPhaseA(
    catalogId,
    majors,
    conflictCounts,
    today,
    catalog,
    subjectCodeByDescription,
  );
  const phaseB = await runPhaseB(catalogId, phaseA.specRefsByParent);
  const { parentsAttached, specsAttached } = attachSpecsToParents(
    phaseA.programs,
    phaseA.specRefsByParent,
    phaseB.specById,
  );

  const degreesByPid = await runPhaseDegrees(catalogId, phaseA.degreeRefBySlug);
  const degreesAttached = attachDegreeRequirements(
    phaseA.programs,
    phaseA.degreeRefBySlug,
    degreesByPid,
  );

  // Re-surface dropped free electives for programs with no totalUnits (after
  // resolveDegreeTotalUnits, so a degree-supplied total still suppresses them).
  foldFreeElectivesIntoUnverified(phaseA.programs, phaseA.freeElectivesBySlug);

  // Stamp the term span now that `totalUnits` is final.
  for (const program of Object.values(phaseA.programs)) {
    program.numberOfTerms = deriveNumberOfTerms(program);
  }

  const outPath = await writeOutput(phaseA.programs);

  console.log(
    `Degree-level requirements: ${degreesByPid.size} pages fetched, attached to ${degreesAttached} programs`,
  );

  console.log(
    `\nWrote ${path.relative(process.cwd(), outPath)}: ${phaseA.withData} programs (${phaseA.skippedNoData.length} skipped for having no parseable data, ${phaseA.failed.length} failed) of ${majors.length} majors`,
  );
  console.log(
    `Specializations: ${phaseB.specById.size} unique fetched / ${phaseB.uniqueSpecIds.length} expected (${phaseB.failedSpecs.length} failed), attached ${specsAttached} times across ${parentsAttached} parents`,
  );

  reportList(
    "programs skipped (none of requiredCoursesTermByTerm / requirements / courseRequirementsNoUnits had content)",
    phaseA.skippedNoData,
  );
  reportList("programs failed during fetch/parse", phaseA.failed);
  reportList("specs failed during fetch/parse", phaseB.failedSpecs);
  reportList("unrecognized-rule warnings", [
    ...phaseA.warnings,
    ...phaseB.warnings,
  ]);
}
