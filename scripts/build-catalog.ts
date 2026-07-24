/**
 * Builds the committed per-term catalog snapshot under data/, joining three
 * sources by lowercased code: UWFlow (spine: code/name/description/prose/ratings),
 * Kuali (units, cross-listings, requisite ASTs), UW Open Data (seating).
 *
 * Usage: `pnpm tsx scripts/build-catalog.ts [--seats-only] [term...]`
 * (default PINNED_TERM). `--seats-only` skips UWFlow/Kuali and just re-fetches
 * Open Data seating into the existing snapshot — seat counts drift weekly, the
 * rest only changes on the order of a term.
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
 * Rewrite only the `sections` of an existing snapshot with fresh seating.
 * Spreading each course preserves key order, so the diff stays seating-only.
 * Descriptions carry no seating and are left untouched.
 */
async function patchSeating(
  termId: number,
  seating: Record<string, CourseSection[]>,
) {
  const coursesPath = path.resolve(
    process.cwd(),
    "data",
    `courses.${termId}.json`,
  );
  let file: CoursesFile;
  try {
    file = validateCoursesFile(
      JSON.parse(await readFile(coursesPath, "utf-8")),
    );
  } catch (err) {
    throw new Error(
      `No usable snapshot for term ${termId} (${err instanceof Error ? err.message : err}) — run a full fetch first: pnpm fetch-courses ${termId}`,
    );
  }
  const updated: CoursesFile = {
    ...file,
    fetchedAt: new Date().toISOString(),
    courses: file.courses.map((c) => ({
      ...c,
      sections: seating[c.code] ?? [],
    })),
  };
  validateCoursesFile(updated);
  await writeFile(coursesPath, JSON.stringify(updated, null, 2), "utf-8");
  const withSeating = updated.courses.filter(
    (c) => c.sections.length > 0,
  ).length;
  return { coursesPath, courseCount: updated.courses.length, withSeating };
}

/**
 * Last-known seating from the committed snapshot, for a partial refresh when
 * Open Data is unavailable (no `UW_OPENDATA_KEY`) — holds `sections` steady
 * rather than wiping them. Absent/unreadable snapshot → empty seating.
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
  const rawArgs = process.argv.slice(2);
  const seatsOnly = rawArgs.includes("--seats-only");
  const args = rawArgs.filter((a) => a !== "--seats-only");
  // Whole-string numeric only — parseInt would silently accept "1261foo".
  for (const a of args.filter((a) => !/^\d+$/.test(a))) {
    console.error(`Skipping non-numeric term arg: ${a}`);
  }
  const validArgs = args.filter((a) => /^\d+$/.test(a));
  if (args.length > 0 && validArgs.length === 0)
    throw new Error("No valid numeric term arguments provided.");
  const terms = args.length > 0 ? validArgs.map(Number) : [PINNED_TERM];

  if (seatsOnly) {
    // Without the key there is nothing this mode could refresh.
    if (!hasOpenDataKey())
      throw new Error("--seats-only requires UW_OPENDATA_KEY.");
    for (const term of terms) {
      process.stdout.write(`Term ${term}: seating from Open Data... `);
      const seating = await fetchSeating(term);
      // An empty map means Open Data returned nothing usable (outage, or an
      // empty-but-valid 200). Overwriting now would wipe every course's seating
      // and the weekly job would commit it — refuse instead of degrading the snapshot.
      if (Object.keys(seating).length === 0) {
        throw new Error(
          `Term ${term}: Open Data returned no seating — refusing to overwrite the committed snapshot. Retry later.`,
        );
      }
      const { coursesPath, courseCount, withSeating } = await patchSeating(
        term,
        seating,
      );
      console.log(
        `${courseCount} courses (${withSeating} with seating) → ${path.relative(process.cwd(), coursesPath)}`,
      );
    }
    return;
  }

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
    // instead of the build aborting or wiping seating.
    let seating: Record<string, CourseSection[]>;
    if (hasOpenDataKey()) {
      process.stdout.write(`Term ${term}: seating from Open Data... `);
      try {
        seating = await fetchSeating(term);
      } catch (err) {
        // A present-but-invalid key or an Open Data outage shouldn't abort the
        // whole build either — keep last-known seating and refresh the rest.
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
