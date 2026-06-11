/**
 * Fetches the UWaterloo course catalog from UWFlow's GraphQL endpoint
 * and writes a per-term JSON snapshot under data/.
 *
 * Usage:
 *   pnpm tsx scripts/fetch-uwflow.ts              # default term = PINNED_TERM
 *   pnpm tsx scripts/fetch-uwflow.ts 1265 1269    # multiple terms
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { CatalogCourse } from "../lib/courses/types";
import {
  CourseSchema,
  type CoursesFile,
  type DescriptionsFile,
  validateCoursesFile,
  validateDescriptionsFile,
} from "../lib/courses/validation";
import { PINNED_TERM } from "../lib/terms";
import { parseKualiAntireqCodes } from "./scrape/kualiRequisites";
import { discoverCatalogId } from "./scrape-programs";

const GRAPHQL_ENDPOINT = "https://uwflow.com/graphql";

// UWFlow exposes no unit weights, so enrich from UW's keyless Kuali catalog:
// one list call for codes+pids, then a detail call per course for credits.value.
const KUALI_BASE = "https://uwaterloocm.kuali.co/api/v1/catalog";
const UNITS_CONCURRENCY = 12;

// UWFlow returns the calendar description; we split it into a sibling
// descriptions file so the committed catalog (and client payload) stays lean.
const FetchedCourseSchema = CourseSchema.extend({
  description: z.string().nullable(),
});
type FetchedCourse = z.infer<typeof FetchedCourseSchema>;

const COURSES_QUERY = `
  query GetCourses($termId: Int!) {
    course(order_by: { code: asc }) {
      id
      code
      name
      description
      prereqs
      coreqs
      antireqs
      rating {
        easy
        useful
        liked
        filled_count
      }
      sections(where: { term_id: { _eq: $termId } }) {
        id
        enrollment_total
        enrollment_capacity
      }
    }
  }
`;

const GraphQLResponseSchema = z.object({
  data: z.object({ course: z.array(FetchedCourseSchema) }).optional(),
  errors: z.array(z.object({ message: z.string() })).optional(),
});

async function fetchTerm(termId: number): Promise<FetchedCourse[]> {
  const res = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: COURSES_QUERY,
      variables: { termId },
    }),
  });

  if (!res.ok) {
    throw new Error(`UWFlow HTTP ${res.status} for term ${termId}`);
  }

  const json = GraphQLResponseSchema.parse(await res.json());
  if (json.errors?.length) {
    throw new Error(`UWFlow GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  if (!json.data) throw new Error("UWFlow returned no data");
  return json.data.course;
}

/** Normalize a Kuali course code ("AMATH 242" → "amath242"); null on empty. */
function normalizeKualiCode(raw: string | undefined | null): string | null {
  const code = raw?.replace(/\s+/g, "").toLowerCase();
  return code && code.length > 0 ? code : null;
}

/** Authoritative per-course data Kuali supplies that UWFlow lacks. */
interface KualiCourseData {
  /** Unit weight: 0.5 standard, 0.25 lab, 1.0+ full-year. Undefined if unknown. */
  units?: number;
  /**
   * Cross-listed equivalents — the same course offered under another code
   * (Kuali's structured `crossListedCourses`). Authoritative source for course
   * equivalence (GitHub #21). Lowercased codes; omitted when there are none.
   */
  crossListed?: string[];
  /**
   * Antirequisite course codes, parsed from Kuali's structured `antirequisites`
   * rule tree (GitHub #21). Authoritative replacement for the regex over UWFlow's
   * free-text antireqs. Lowercased; omitted when there are none.
   */
  antireqCodes?: string[];
}

/**
 * Fetch authoritative per-course data from UW's Kuali catalog, keyed by
 * lowercased course code. One list call for codes+pids, then a detail call per
 * course. The detail object also carries unit weight (`credits.value`) and the
 * structured `crossListedCourses` equivalence list.
 */
async function fetchKualiData(): Promise<Record<string, KualiCourseData>> {
  const getJson = async <T>(url: string): Promise<T> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as T;
      } catch (err) {
        if (attempt === 2) throw err;
      }
    }
    throw new Error("unreachable");
  };

  const catalogId = await discoverCatalogId();
  const list = await getJson<
    Array<{ __catalogCourseId?: string; pid: string }>
  >(`${KUALI_BASE}/courses/${catalogId}`);

  const data: Record<string, KualiCourseData> = {};
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= list.length) return;
      const entry = list[i];
      const code = normalizeKualiCode(entry.__catalogCourseId);
      if (!code) continue;
      try {
        const detail = await getJson<{
          credits?: { value?: string } | null;
          crossListedCourses?: Array<{ __catalogCourseId?: string }> | null;
          antirequisites?: string | null;
        }>(
          `${KUALI_BASE}/course/${catalogId}/${encodeURIComponent(entry.pid)}`,
        );
        const record: KualiCourseData = {};
        const value = Number(detail.credits?.value);
        if (Number.isFinite(value)) record.units = value;
        const crossListed = (detail.crossListedCourses ?? [])
          .map((x) => normalizeKualiCode(x.__catalogCourseId))
          .filter((c): c is string => c !== null && c !== code);
        if (crossListed.length > 0)
          record.crossListed = [...new Set(crossListed)];
        const antireqCodes = parseKualiAntireqCodes(
          detail.antirequisites,
        ).filter((a) => a !== code);
        if (antireqCodes.length > 0) record.antireqCodes = antireqCodes;
        if (record.units != null || record.crossListed || record.antireqCodes)
          data[code] = record;
      } catch {
        // skip; the course loads without Kuali enrichment (audit still counts it)
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(UNITS_CONCURRENCY, list.length) }, worker),
  );
  return data;
}

async function writeSnapshot(
  termId: number,
  courses: FetchedCourse[],
  kuali: Record<string, KualiCourseData>,
) {
  const dataDir = path.resolve(process.cwd(), "data");
  await mkdir(dataDir, { recursive: true });
  const fetchedAt = new Date().toISOString();

  // Split each fetched course into the lean catalog record and the keyed
  // description, then write them to sibling files. Kuali enrichment (units,
  // cross-listings) is joined by lowercased code.
  const lean: CatalogCourse[] = [];
  const descriptions: Record<string, string> = {};
  for (const { description, ...rest } of courses) {
    const enrich = kuali[rest.code];
    lean.push({
      ...rest,
      ...(enrich?.units != null ? { units: enrich.units } : {}),
      ...(enrich?.crossListed ? { crossListed: enrich.crossListed } : {}),
      ...(enrich?.antireqCodes ? { antireqCodes: enrich.antireqCodes } : {}),
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
  console.log(
    `${Object.keys(kuali).length} courses (${withUnitsTotal} with units, ${withCrossListed} cross-listed, ${withAntireqs} with antireqs)`,
  );

  for (const term of terms) {
    if (!Number.isInteger(term)) {
      console.error(`Skipping non-numeric term arg: ${term}`);
      continue;
    }
    process.stdout.write(`Fetching term ${term}... `);
    const raw = await fetchTerm(term);
    const courses = raw.filter((c) => !/xxx$/i.test(c.code));
    const { coursesPath, descriptionsPath } = await writeSnapshot(
      term,
      courses,
      kuali,
    );
    const withUnits = courses.filter(
      (c) => kuali[c.code]?.units != null,
    ).length;
    console.log(
      `${courses.length} courses (${withUnits} with units) → ${path.relative(process.cwd(), coursesPath)} + ${path.relative(process.cwd(), descriptionsPath)}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
