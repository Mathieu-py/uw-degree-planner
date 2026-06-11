/**
 * Fetches the course catalog from UWFlow's GraphQL endpoint — the primary spine
 * (code, name, description, requirement prose, crowd-sourced ratings). Seating
 * comes from UW Open Data and structured requisites from Kuali; those are joined
 * on by the catalog builder (`scripts/build-catalog.ts`).
 */

import { z } from "zod";
import { CourseSchema } from "../../lib/courses/validation";

const GRAPHQL_ENDPOINT = "https://uwflow.com/graphql";

// UWFlow returns the calendar description; the builder splits it into a sibling
// descriptions file so the committed catalog stays lean. Sections come from Open
// Data, not UWFlow, so they're omitted here and joined in by the builder.
const UWFlowCourseSchema = CourseSchema.omit({ sections: true }).extend({
  description: z.string().nullable(),
});
export type UWFlowCourse = z.infer<typeof UWFlowCourseSchema>;

// No term variable: the fields we take from UWFlow (name, prose, ratings) are
// term-independent. Seating — the only term-scoped data — now comes from Open
// Data, so a `$termId` here would be an unused variable UWFlow's API rejects.
const COURSES_QUERY = `
  query GetCourses {
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
    }
  }
`;

const GraphQLResponseSchema = z.object({
  data: z.object({ course: z.array(UWFlowCourseSchema) }).optional(),
  errors: z.array(z.object({ message: z.string() })).optional(),
});

/** Fetch every UWFlow course (term-independent: name, prose, crowd ratings). */
export async function fetchUWFlowCourses(): Promise<UWFlowCourse[]> {
  const res = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: COURSES_QUERY }),
  });

  if (!res.ok) {
    throw new Error(`UWFlow HTTP ${res.status}`);
  }

  const json = GraphQLResponseSchema.parse(await res.json());
  if (json.errors?.length) {
    throw new Error(`UWFlow GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  if (!json.data) throw new Error("UWFlow returned no data");
  return json.data.course;
}
