/**
 * Barrel for the Kuali program-detail parsers. The implementation lives in
 * `scripts/scrape/` — one module per concern (rule-tree requirements, subject
 * pools, electives, unit plan, degree-level requirements, slugs). This file is
 * the stable entry point the scraper and its tests import from.
 */
export { parseAdditionalConstraints } from "./additionalConstraints";
export {
  type DegreeParseResult,
  parseDegreeRequirements,
} from "./degree";
export { parseElectives } from "./electives";
export { normalizeCourseCode } from "./normalize";
export { parseProgramRequirements } from "./requirements";
export {
  buildConflictCounts,
  buildProgramSlug,
  buildSpecializationSlug,
  parseSpecializationsList,
} from "./slugs";
export {
  dropPureUnitBucketElectives,
  parseUnitPlan,
} from "./unitPlan";
