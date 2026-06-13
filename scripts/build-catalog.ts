/**
 * Builds the committed per-term catalog snapshot under data/, joining three
 * sources by lowercased code: UWFlow (spine: code/name/description/prose/ratings),
 * Kuali (units, cross-listings, requisite ASTs), UW Open Data (seating).
 *
 * Usage: `pnpm tsx scripts/build-catalog.ts [term...]` (default PINNED_TERM).
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

// Load .env.local for UW_OPENDATA_KEY (Next.js does this for the app; this script
// doesn't). Tolerate a missing file — CI may set the var directly.
try {
  process.loadEnvFile(".env.local");
} catch {
  // rely on the ambient environment
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

  // Split each course into the lean record + keyed description (sibling files).
  // Kuali enrichment and Open Data seating join by lowercased code.
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

  // Fail fast on a bad shape: the app loads these via the same validate*File.
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
  // Whole-string numeric only — parseInt would silently accept "1261foo".
  for (const a of args.filter((a) => !/^\d+$/.test(a))) {
    console.error(`Skipping non-numeric term arg: ${a}`);
  }
  const validArgs = args.filter((a) => /^\d+$/.test(a));
  const terms = args.length > 0 ? validArgs.map(Number) : [PINNED_TERM];
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
