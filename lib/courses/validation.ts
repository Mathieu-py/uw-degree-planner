/**
 * Boundary validator for the committed data/ snapshots (hand-editable): a zod
 * parse fails fast with the bad field's path instead of a deep downstream TypeError.
 */

import { z } from "zod";
import type { PrereqNode } from "@/lib/prereqs/parse";

/**
 * Canonical stored course code: lowercase letters, digits, optional letter
 * suffix (e.g. "cs135", "pd1", "emls101r"). Codes are lowercased/space-stripped
 * on ingest (see lib/prereqs/parse.ts), so the snapshot should never carry a
 * raw-case or spaced form. Applied to the requirement-bearing fields below; the
 * primary `code` stays lenient because the committed snapshot still carries a
 * handful of inert UWFlow placeholder codes (build-catalog now filters them).
 */
const CODE_RE = /^[a-z]+\d+[a-z]*$/;
const codeString = z.string().regex(CODE_RE);

/**
 * Recursive validator for a stored prereq/coreq AST (Kuali-derived; see
 * {@link PrereqNode}). Now committed to the snapshot, so shape-checked at build and load.
 */
const PrereqNodeSchema: z.ZodType<PrereqNode> = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal("course"), code: codeString }),
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
  id: z.number().int(),
  enrollment_total: z.number().int().nonnegative(),
  enrollment_capacity: z.number().int().nonnegative(),
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
  crossListed: z.array(codeString).optional(),
  antireqCodes: z.array(codeString).optional(),
  prereqAst: PrereqNodeSchema.nullable().optional(),
  coreqAst: PrereqNodeSchema.nullable().optional(),
});

const CoursesFileSchema = z
  .object({
    termId: z.number().int().positive(),
    fetchedAt: z.iso.datetime(),
    courseCount: z.number().int().nonnegative(),
    courses: z.array(CourseSchema),
  })
  .refine((f) => f.courseCount === f.courses.length, {
    message: "courseCount must equal courses.length",
    path: ["courseCount"],
  });

export type CoursesFile = z.infer<typeof CoursesFileSchema>;

// Calendar descriptions, split out of the catalog so the planner payload
// stays lean. Keyed by course code; only courses with prose appear.
const DescriptionsFileSchema = z.object({
  termId: z.number().int().positive(),
  fetchedAt: z.iso.datetime(),
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
