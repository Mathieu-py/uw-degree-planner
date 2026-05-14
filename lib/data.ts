/**
 * Server-only data loader. Reads the committed UWFlow snapshot JSON,
 * enriches each row with derived fields, and memoises across requests
 * via React's cache() so subsequent server components share the result.
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
