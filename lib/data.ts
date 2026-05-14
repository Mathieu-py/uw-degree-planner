/**
 * Server-only loader for the committed UWFlow snapshot. Wrapped in React's
 * cache() so a single request that hits multiple server components (page,
 * metadata, etc.) reads and parses the JSON only once.
 */

import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";
import { enrichCourse } from "./filters";
import type { Course, TermId, UWFlowCourse } from "./types";

interface CoursesFile {
  termId: number;
  fetchedAt: string;
  courseCount: number;
  courses: UWFlowCourse[];
}

export const loadTerm = cache(async (termId: TermId): Promise<Course[]> => {
  const file = path.resolve(process.cwd(), "data", `courses.${termId}.json`);
  const raw = await readFile(file, "utf-8");
  const parsed = JSON.parse(raw) as CoursesFile;
  return parsed.courses.map(enrichCourse);
});

export const loadCourseByCode = cache(
  async (termId: TermId, code: string): Promise<Course | null> => {
    const all = await loadTerm(termId);
    return all.find((c) => c.code === code.toLowerCase()) ?? null;
  },
);
