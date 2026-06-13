/**
 * Boundary validator for the committed data/ snapshots (hand-editable): a zod
 * parse fails fast with the bad field's path instead of a deep downstream TypeError.
 */

import { z } from "zod";
import type { PrereqNode } from "@/lib/prereqs/parse";

/**
 * Recursive validator for a stored prereq/coreq AST (Kuali-derived; see
 * {@link PrereqNode}). Now committed to the snapshot, so shape-checked at build and load.
 */
const PrereqNodeSchema: z.ZodType<PrereqNode> = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal("course"), code: z.string().min(1) }),
    z.object({ kind: z.literal("and"), children: z.array(PrereqNodeSchema) }),
    z.object({ kind: z.literal("or"), children: z.array(PrereqNodeSchema) }),
    z.object({
      kind: z.literal("countOf"),
      n: z.number().int().positive(),
      children: z.array(PrereqNodeSchema),
    }),
    z.object({ kind: z.literal("level"), minLevel: z.string().min(1) }),
    z.object({ kind: z.literal("program"), clause: z.string() }),
    z.object({ kind: z.literal("coreqOf"), child: PrereqNodeSchema }),
    z.object({ kind: z.literal("raw"), text: z.string() }),
  ]),
);

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
  units: z.number().min(0).max(3).optional(),
  crossListed: z.array(z.string().min(1)).optional(),
  antireqCodes: z.array(z.string().min(1)).optional(),
  prereqAst: PrereqNodeSchema.nullable().optional(),
  coreqAst: PrereqNodeSchema.nullable().optional(),
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
