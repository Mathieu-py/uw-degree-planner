/**
 * Fetches the UWaterloo course catalog from UWFlow's GraphQL endpoint
 * and writes a per-term JSON snapshot under data/.
 *
 * Usage:
 *   pnpm tsx scripts/fetch-uwflow.ts              # default term 1261
 *   pnpm tsx scripts/fetch-uwflow.ts 1265 1269    # multiple terms
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { UWFlowCourse } from "../lib/types";
import { CourseSchema } from "../lib/validation";

const GRAPHQL_ENDPOINT = "https://uwflow.com/graphql";

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
  data: z.object({ course: z.array(CourseSchema) }).optional(),
  errors: z.array(z.object({ message: z.string() })).optional(),
});

async function fetchTerm(termId: number): Promise<UWFlowCourse[]> {
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

interface CoursesFile {
  termId: number;
  fetchedAt: string;
  courseCount: number;
  courses: UWFlowCourse[];
}

async function writeSnapshot(termId: number, courses: UWFlowCourse[]) {
  const dataDir = path.resolve(process.cwd(), "data");
  await mkdir(dataDir, { recursive: true });
  const file: CoursesFile = {
    termId,
    fetchedAt: new Date().toISOString(),
    courseCount: courses.length,
    courses,
  };
  const outPath = path.join(dataDir, `courses.${termId}.json`);
  await writeFile(outPath, JSON.stringify(file, null, 2), "utf-8");
  return outPath;
}

async function main() {
  const args = process.argv.slice(2);
  const terms = args.length > 0 ? args.map((a) => parseInt(a, 10)) : [1261];
  for (const term of terms) {
    if (!Number.isInteger(term)) {
      console.error(`Skipping non-numeric term arg: ${term}`);
      continue;
    }
    process.stdout.write(`Fetching term ${term}... `);
    const raw = await fetchTerm(term);
    const courses = raw.filter((c) => !/xxx$/i.test(c.code));
    const out = await writeSnapshot(term, courses);
    console.log(
      `${courses.length} courses → ${path.relative(process.cwd(), out)}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
