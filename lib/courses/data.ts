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

export const loadTerm = cache(async (termId: TermId): Promise<Course[]> => {
  const file = path.resolve(process.cwd(), "data", `courses.${termId}.json`);
  const raw = await readFile(file, "utf-8");
  const parsed = validateCoursesFile(JSON.parse(raw));
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
    const raw = await readFile(file, "utf-8");
    return validateDescriptionsFile(JSON.parse(raw)).descriptions;
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
