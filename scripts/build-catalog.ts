/**
 * Builds the committed per-term course catalog snapshot under data/ by combining
 * three UW sources, joined by lowercased course code:
 *   - UWFlow      → spine: code, name, description, requirement prose, ratings
 *                   (`./scrape/uwflowCourses`)
 *   - Kuali       → units, cross-listings, structured requisite ASTs
 *                   (`./scrape/kualiCourses`)
 *   - UW Open Data → live section seating (`./scrape/openData`)
 *
 * Usage:
 *   pnpm tsx scripts/build-catalog.ts            # default term = PINNED_TERM
 *   pnpm tsx scripts/build-catalog.ts 1265 1269  # multiple terms
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CatalogCourse, CourseSection } from "../lib/courses/types";
import {
  type CoursesFile,
  type DescriptionsFile,
  validateCoursesFile,
  validateDescriptionsFile,
} from "../lib/courses/validation";
import { PINNED_TERM } from "../lib/terms";
import { fetchKualiData, type KualiCourseData } from "./scrape/kualiCourses";
import { fetchSeating } from "./scrape/openData";
import { fetchUWFlowCourses, type UWFlowCourse } from "./scrape/uwflowCourses";

// Load .env.local so UW_OPENDATA_KEY is available (Next.js loads it for the app,
// but this standalone script doesn't). CI may set the var directly, so tolerate
// a missing file.
try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — rely on the ambient environment
}

async function writeSnapshot(
  termId: number,
  courses: UWFlowCourse[],
  kuali: Record<string, KualiCourseData>,
  seating: Record<string, CourseSection[]>,
) {
  const dataDir = path.resolve(process.cwd(), "data");
  await mkdir(dataDir, { recursive: true });
  const fetchedAt = new Date().toISOString();

  // Split each course into the lean catalog record and the keyed description,
  // then write them to sibling files. Kuali enrichment (units, cross-listings,
  // requisites) and Open Data seating are joined by lowercased code.
  const lean: CatalogCourse[] = [];
  const descriptions: Record<string, string> = {};
  for (const { description, ...rest } of courses) {
    const enrich = kuali[rest.code];
    lean.push({
      ...rest,
      sections: seating[rest.code] ?? [],
      ...(enrich?.units != null ? { units: enrich.units } : {}),
      ...(enrich?.crossListed ? { crossListed: enrich.crossListed } : {}),
      ...(enrich?.antireqCodes ? { antireqCodes: enrich.antireqCodes } : {}),
      ...(enrich?.prereqAst ? { prereqAst: enrich.prereqAst } : {}),
      ...(enrich?.coreqAst ? { coreqAst: enrich.coreqAst } : {}),
    });
    if (description && description.trim() !== "") {
      descriptions[rest.code] = description;
    }
  }

  const coursesFile: CoursesFile = {
    termId,
    fetchedAt,
    courseCount: lean.length,
    courses: lean,
  };
  const descriptionsFile: DescriptionsFile = {
    termId,
    fetchedAt,
    descriptions,
  };

  // Fail fast on a malformed shape rather than committing files the app would
  // reject at load (it parses these same schemas via validate*File).
  validateCoursesFile(coursesFile);
  validateDescriptionsFile(descriptionsFile);

  const coursesPath = path.join(dataDir, `courses.${termId}.json`);
  const descriptionsPath = path.join(dataDir, `descriptions.${termId}.json`);
  await writeFile(coursesPath, JSON.stringify(coursesFile, null, 2), "utf-8");
  await writeFile(
    descriptionsPath,
    JSON.stringify(descriptionsFile, null, 2),
    "utf-8",
  );
  return { coursesPath, descriptionsPath };
}

async function main() {
  const args = process.argv.slice(2);
  const terms =
    args.length > 0 ? args.map((a) => parseInt(a, 10)) : [PINNED_TERM];
  process.stdout.write("Fetching course data from Kuali... ");
  const kuali = await fetchKualiData();
  const withUnitsTotal = Object.values(kuali).filter(
    (k) => k.units != null,
  ).length;
  const withCrossListed = Object.values(kuali).filter(
    (k) => k.crossListed,
  ).length;
  const withAntireqs = Object.values(kuali).filter(
    (k) => k.antireqCodes,
  ).length;
  const withPrereqAst = Object.values(kuali).filter((k) => k.prereqAst).length;
  console.log(
    `${Object.keys(kuali).length} courses (${withUnitsTotal} units, ${withCrossListed} cross-listed, ${withAntireqs} antireqs, ${withPrereqAst} prereq-ASTs)`,
  );

  // UWFlow's fields are term-independent, so fetch the course list once.
  process.stdout.write("Fetching courses from UWFlow... ");
  const raw = await fetchUWFlowCourses();
  const courses = raw.filter((c) => !/xxx$/i.test(c.code));
  console.log(`${courses.length} courses`);

  for (const term of terms) {
    if (!Number.isInteger(term)) {
      console.error(`Skipping non-numeric term arg: ${term}`);
      continue;
    }
    process.stdout.write(`Term ${term}: seating from Open Data... `);
    const seating = await fetchSeating(term);
    const { coursesPath, descriptionsPath } = await writeSnapshot(
      term,
      courses,
      kuali,
      seating,
    );
    const withSeating = courses.filter(
      (c) => (seating[c.code]?.length ?? 0) > 0,
    ).length;
    console.log(
      `${courses.length} courses (${withSeating} with seating) → ${path.relative(process.cwd(), coursesPath)} + ${path.relative(process.cwd(), descriptionsPath)}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
