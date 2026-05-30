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
} from "../lib/courses/validation";
import { PINNED_TERM } from "../lib/terms";

const GRAPHQL_ENDPOINT = "https://uwflow.com/graphql";

// UWFlow returns the calendar description; we keep it through the fetch and
// then split it into a sibling descriptions file so the committed catalog
// (and the client payload built from it) stays lean.
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

async function writeSnapshot(termId: number, courses: FetchedCourse[]) {
  const dataDir = path.resolve(process.cwd(), "data");
  await mkdir(dataDir, { recursive: true });
  const fetchedAt = new Date().toISOString();

  // Split each fetched course into the lean catalog record and the keyed
  // description, then write them to sibling files.
  const lean: CatalogCourse[] = [];
  const descriptions: Record<string, string> = {};
  for (const { description, ...rest } of courses) {
    lean.push(rest);
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
    );
    console.log(
      `${courses.length} courses → ${path.relative(process.cwd(), coursesPath)} + ${path.relative(process.cwd(), descriptionsPath)}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
