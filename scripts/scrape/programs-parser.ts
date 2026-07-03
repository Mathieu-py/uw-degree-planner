/**
 * Barrel for the Kuali program-detail parsers. The implementation lives in
 * `scripts/scrape/` — one module per concern (rule-tree requirements, subject
 * pools, electives, unit plan, degree-level requirements, slugs). This file is
 * the stable entry point the scraper and its tests import from.
 */
export { parseAdditionalConstraints } from "./program/additionalConstraints";
export {
  type DegreeParseResult,
  parseDegreeRequirements,
} from "./program/degree";
export { parseElectives } from "./program/electives";
export {
  buildConflictCounts,
  buildProgramSlug,
  buildSpecializationSlug,
  parseSpecializationsList,
} from "./program/slugs";
export {
  dropPureUnitBucketElectives,
  parseUnitPlan,
} from "./program/unitPlan";
export { parseProgramRequirements } from "./requirements";
export { normalizeCourseCode } from "./util/normalize";
