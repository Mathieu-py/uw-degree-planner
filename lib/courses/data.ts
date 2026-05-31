/**
 * Server-only loader for the committed UWFlow snapshot. Wrapped in React's
 * cache() so a single request that hits multiple server components (page,
 * metadata, etc.) reads and parses the JSON only once.
 */

import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";
import type { TermId } from "@/lib/terms";
import { enrichCourse } from "./filters";
import type { Course, CourseDetail } from "./types";
import { validateCoursesFile, validateDescriptionsFile } from "./validation";

/**
 * Raised when a snapshot file can't be read or parsed. Shape-validation
 * failures still throw CoursesFileError from ./validation; this just turns a
 * raw ENOENT/SyntaxError into a message that names the file.
 */
export class CourseDataError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CourseDataError";
  }
}

async function readJsonFile(file: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(file, "utf-8");
  } catch (cause) {
    throw new CourseDataError(`Could not read course data file at ${file}.`, {
      cause,
    });
  }
  try {
    return JSON.parse(raw);
  } catch (cause) {
    throw new CourseDataError(
      `Course data file at ${file} is not valid JSON.`,
      { cause },
    );
  }
}

export const loadTerm = cache(async (termId: TermId): Promise<Course[]> => {
  const file = path.resolve(process.cwd(), "data", `courses.${termId}.json`);
  const parsed = validateCoursesFile(await readJsonFile(file));
  return parsed.courses.map(enrichCourse);
});

/**
 * Course descriptions live in a sibling `descriptions.<term>.json` file rather
 * than the catalog so the ~3MB of calendar prose never enters the planner's
 * client payload. Only the /course/[code] route pulls it in: it reads the term's
 * descriptions once per request (cached), then indexes the one code it needs.
 */
const loadDescriptions = cache(
  async (termId: TermId): Promise<Record<string, string>> => {
    const file = path.resolve(
      process.cwd(),
      "data",
      `descriptions.${termId}.json`,
    );
    return validateDescriptionsFile(await readJsonFile(file)).descriptions;
  },
);

export const loadCourseByCode = cache(
  async (termId: TermId, code: string): Promise<CourseDetail | null> => {
    const all = await loadTerm(termId);
    const course = all.find((c) => c.code === code.toLowerCase());
    if (!course) return null;
    const descriptions = await loadDescriptions(termId);
    return { ...course, description: descriptions[course.code] ?? null };
  },
);
