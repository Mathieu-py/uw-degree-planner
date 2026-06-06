/**
 * Barrel for the Kuali program-detail parsers. The implementation lives in
 * `scripts/scrape/` — one module per concern (rule-tree requirements, subject
 * pools, electives, unit plan, degree-level requirements, slugs). This file is
 * the stable entry point the scraper and its tests import from.
 */
export {
  type DegreeParseResult,
  parseDegreeRequirements,
} from "./scrape/degree";
export { parseElectives } from "./scrape/electives";
export { normalizeCourseCode } from "./scrape/normalize";
export { parseProgramRequirements } from "./scrape/requirements";
export {
  buildConflictCounts,
  buildProgramSlug,
  buildSpecializationSlug,
  parseSpecializationsList,
} from "./scrape/slugs";
export {
  parseUnitPlan,
  reconcileUnitsAndElectives,
} from "./scrape/unitPlan";
