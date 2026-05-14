/**
 * Regression check: applies SYDE_M1_DEFAULTS to the committed snapshot at
 * data/courses.1261.json and confirms the result matches a hand-curated
 * baseline of 27 codes. Re-run after each pnpm fetch-courses to catch
 * filter regressions caused by upstream catalog drift.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { applyFilters, enrichCourse, SYDE_M1_DEFAULTS } from "~/utils/filters";
import type { UWFlowCourse } from "~/types";

interface CoursesFile {
  termId: number;
  courses: UWFlowCourse[];
}

const EXPECTED_CODES = new Set([
  "ae224", "asl101r", "bet100", "bet201", "bet210", "bet300", "bet320",
  "bet340", "bet350", "cive392", "comm101", "econ102", "enve224",
  "indent310", "indent320", "innov201", "ne131", "optom152l", "optom255l",
  "psych101", "rsch100", "sci238", "sci267", "sci281", "sci300",
  "stv100", "stv208",
]);

async function main() {
  const file = path.resolve(process.cwd(), "data/courses.1261.json");
  const raw = await readFile(file, "utf-8");
  const parsed = JSON.parse(raw) as CoursesFile;
  const enriched = parsed.courses.map(enrichCourse);
  const filtered = applyFilters(enriched, SYDE_M1_DEFAULTS);

  const actualCodes = new Set(filtered.map((c) => c.code));
  const missing = [...EXPECTED_CODES].filter((c) => !actualCodes.has(c));
  const unexpected = [...actualCodes].filter((c) => !EXPECTED_CODES.has(c));

  console.log(`Filter input:    ${enriched.length} courses`);
  console.log(`Filter output:   ${filtered.length} courses`);
  console.log(`Expected:        ${EXPECTED_CODES.size} courses`);

  if (missing.length === 0 && unexpected.length === 0) {
    console.log("\nPASS — output matches the baseline exactly.");
    return;
  }

  console.log("\nFAIL — output diverges from the baseline.");
  if (missing.length) {
    console.log(`Missing (${missing.length}): ${missing.join(", ")}`);
  }
  if (unexpected.length) {
    console.log(`Unexpected (${unexpected.length}): ${unexpected.join(", ")}`);
  }
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
