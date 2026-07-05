/**
 * Scrapes the UWaterloo undergraduate calendar (Kuali backend) and writes
 * data/programs.json with one entry per undergraduate Major.
 *
 * Run manually:
 *   pnpm scrape-programs
 *
 * Re-run when the calendar updates (typically once per academic year).
 *
 * This is the thin entry point. The pipeline lives in `scripts/scrape/pipeline/`
 * and Kuali catalog discovery in `scripts/scrape/sources/kualiCatalog.ts`. The
 * re-exports below keep the `../scrape-programs` import path the tests use.
 */
import { main } from "./scrape/pipeline/run";
import { isDirectInvocation } from "./scrape/util/entry";

export {
  foldFreeElectivesIntoUnverified,
  normalizeFaculty,
} from "./scrape/pipeline/programs";
export type {
  ProgramDetail,
  SpecializationRef,
} from "./scrape/pipeline/shared";
export {
  attachSpecsToParents,
  buildSpecialization,
  collectUniqueSpecIds,
  resolveSpecSlug,
} from "./scrape/pipeline/specializations";
export {
  discoverCatalog,
  discoverCatalogId,
  stripSubjectCodeSuffix,
} from "./scrape/sources/kualiCatalog";

// Run main() only when invoked directly (not when imported by tests).
if (isDirectInvocation(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
