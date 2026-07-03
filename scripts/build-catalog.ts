/**
 * Builds the committed per-term catalog snapshot under data/, joining three
 * sources by lowercased code: UWFlow (spine: code/name/description/prose/ratings),
 * Kuali (units, cross-listings, requisite ASTs), UW Open Data (seating).
 *
 * Usage: `pnpm tsx scripts/build-catalog.ts [term...]` (default PINNED_TERM).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CatalogCourse, CourseSection } from "../lib/courses/types";
import {
  type CoursesFile,
  type DescriptionsFile,
  validateCoursesFile,
  validateDescriptionsFile,
} from "../lib/courses/validation";
import { PINNED_TERM } from "../lib/terms";
import {
  fetchKualiData,
  type KualiCourseData,
} from "./scrape/sources/kualiCourses";
import {
  fetchSeating,
  hasOpenDataKey,
  seatingFromSnapshot,
} from "./scrape/sources/openData";
import {
  fetchUWFlowCourses,
  type UWFlowCourse,
} from "./scrape/sources/uwflowCourses";

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

/**
 * Last-known seating from the committed snapshot, for a partial refresh when
 * Open Data is unavailable (no `UW_OPENDATA_KEY`) — holds `sections` steady
 * rather than wiping them. Absent/unreadable snapshot → empty seating. #120.
 */
async function loadExistingSeating(
  termId: number,
): Promise<Record<string, CourseSection[]>> {
  const snapshotPath = path.resolve(
    process.cwd(),
    "data",
    `courses.${termId}.json`,
  );
  try {
    const file = validateCoursesFile(
      JSON.parse(await readFile(snapshotPath, "utf-8")),
    );
    return seatingFromSnapshot(file.courses);
  } catch (err) {
    console.warn(
      `No reusable seating for term ${termId} (${err instanceof Error ? err.message : err}) — writing empty seating.`,
    );
    return {};
  }
}

async function main() {
  const args = process.argv.slice(2);
  // Whole-string numeric only — parseInt would silently accept "1261foo".
  for (const a of args.filter((a) => !/^\d+$/.test(a))) {
    console.error(`Skipping non-numeric term arg: ${a}`);
  }
  const validArgs = args.filter((a) => /^\d+$/.test(a));
  if (args.length > 0 && validArgs.length === 0)
    throw new Error("No valid numeric term arguments provided.");
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
  const withCoreqAst = Object.values(kuali).filter((k) => k.coreqAst).length;
  console.log(
    `${Object.keys(kuali).length} courses (${withUnitsTotal} units, ${withCrossListed} cross-listed, ${withAntireqs} antireqs, ${withPrereqAst} prereq-ASTs, ${withCoreqAst} coreq-ASTs)`,
  );

  // UWFlow's fields are term-independent, so fetch the course list once. Drop
  // `xxx`-suffixed placeholders and any non-canonical code (UWFlow carries
  // high-school/transfer pseudo-courses like `hschem`/`arts1x000` that have no
  // Kuali enrichment and never appear in a program rule).
  process.stdout.write("Fetching courses from UWFlow... ");
  const raw = await fetchUWFlowCourses();
  const courses = raw.filter(
    (c) => !/xxx$/i.test(c.code) && /^[a-z]+\d+[a-z]*$/.test(c.code),
  );
  const proseFallback = courses.filter(
    (c) => !kuali[c.code]?.prereqAst && c.prereqs?.trim(),
  ).length;
  console.log(
    `${courses.length} courses (${raw.length - courses.length} placeholder codes dropped, ${proseFallback} on prereq prose fallback)`,
  );

  for (const term of terms) {
    // Missing key (e.g. CI without the secret) is non-fatal: keep last-known
    // seating from the committed snapshot so ratings/prose/Kuali still refresh
    // instead of the build aborting or wiping seating. #120.
    let seating: Record<string, CourseSection[]>;
    if (hasOpenDataKey()) {
      process.stdout.write(`Term ${term}: seating from Open Data... `);
      try {
        seating = await fetchSeating(term);
      } catch (err) {
        // A present-but-invalid key or an Open Data outage shouldn't abort the
        // whole build either — keep last-known seating and refresh the rest. #120.
        console.warn(
          `\nTerm ${term}: Open Data seating fetch failed (${err instanceof Error ? err.message : err}) — reusing seating from the existing snapshot.`,
        );
        seating = await loadExistingSeating(term);
      }
    } else {
      console.warn(
        `Term ${term}: UW_OPENDATA_KEY unset — reusing seating from the existing snapshot (partial refresh).`,
      );
      seating = await loadExistingSeating(term);
    }
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
