/**
 * Boundary validator for the committed UWFlow snapshots in data/. The fetch
 * script produces these files but anyone can hand-edit them, and a malformed
 * field would otherwise surface as a deep TypeError inside enrichCourse or
 * the prereq parser. A zod parse fails fast at the boundary with a path that
 * pinpoints the offending field.
 */

import { z } from "zod";

const RatingSchema = z
  .object({
    easy: z.number().nullable(),
    useful: z.number().nullable(),
    liked: z.number().nullable(),
    filled_count: z.number().nullable(),
  })
  .nullable();

const SectionSchema = z.object({
  id: z.number(),
  enrollment_total: z.number(),
  enrollment_capacity: z.number(),
});

export const CourseSchema = z.object({
  id: z.number(),
  code: z.string().min(1),
  name: z.string(),
  prereqs: z.string().nullable(),
  coreqs: z.string().nullable(),
  antireqs: z.string().nullable(),
  rating: RatingSchema,
  sections: z.array(SectionSchema),
});

const CoursesFileSchema = z.object({
  termId: z.number(),
  fetchedAt: z.string(),
  courseCount: z.number(),
  courses: z.array(CourseSchema),
});

export type CoursesFile = z.infer<typeof CoursesFileSchema>;

// Calendar descriptions, split out of the catalog so the planner payload
// stays lean. Keyed by course code; only courses with prose appear.
const DescriptionsFileSchema = z.object({
  termId: z.number(),
  fetchedAt: z.string(),
  descriptions: z.record(z.string(), z.string()),
});

export type DescriptionsFile = z.infer<typeof DescriptionsFileSchema>;

export class CoursesFileError extends Error {
  constructor(message: string) {
    super(`Invalid courses file: ${message}`);
    this.name = "CoursesFileError";
  }
}

export function validateCoursesFile(raw: unknown): CoursesFile {
  const result = CoursesFileSchema.safeParse(raw);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const path = issue.path.join(".") || "top-level";
  throw new CoursesFileError(`${path}: ${issue.message}`);
}

export function validateDescriptionsFile(raw: unknown): DescriptionsFile {
  const result = DescriptionsFileSchema.safeParse(raw);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const path = issue.path.join(".") || "top-level";
  throw new CoursesFileError(`${path}: ${issue.message}`);
}
