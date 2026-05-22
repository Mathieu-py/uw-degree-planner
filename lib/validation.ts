/**
 * Boundary validator for the committed UWFlow snapshots in data/. The fetch
 * script produces these files but anyone can hand-edit them, and a malformed
 * field would otherwise surface as a deep TypeError inside enrichCourse or
 * the prereq parser. We check the shape up front and throw a single message
 * that says exactly which course and field are wrong.
 *
 * Intentionally not a full schema validator: it covers the fields the app
 * actually reads, leaves the others alone, and pulls in no dependencies.
 */

import type { UWFlowCourse } from "./types";

export interface CoursesFile {
  termId: number;
  fetchedAt: string;
  courseCount: number;
  courses: UWFlowCourse[];
}

export class CoursesFileError extends Error {
  constructor(message: string) {
    super(`Invalid courses file: ${message}`);
    this.name = "CoursesFileError";
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNumberOrNull(v: unknown): v is number | null {
  return v === null || typeof v === "number";
}

function isStringOrNull(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}

function validateSection(s: unknown, where: string): void {
  if (!isObject(s)) throw new CoursesFileError(`${where} is not an object`);
  if (typeof s.id !== "number")
    throw new CoursesFileError(`${where}.id missing or not a number`);
  if (typeof s.enrollment_total !== "number") {
    throw new CoursesFileError(
      `${where}.enrollment_total missing or not a number`,
    );
  }
  if (typeof s.enrollment_capacity !== "number") {
    throw new CoursesFileError(
      `${where}.enrollment_capacity missing or not a number`,
    );
  }
}

function validateRating(r: unknown, where: string): void {
  if (r === null) return;
  if (!isObject(r))
    throw new CoursesFileError(`${where} is not an object or null`);
  if (!isNumberOrNull(r.easy))
    throw new CoursesFileError(`${where}.easy not a number or null`);
  if (!isNumberOrNull(r.useful))
    throw new CoursesFileError(`${where}.useful not a number or null`);
  if (!isNumberOrNull(r.liked))
    throw new CoursesFileError(`${where}.liked not a number or null`);
  if (!isNumberOrNull(r.filled_count)) {
    throw new CoursesFileError(`${where}.filled_count not a number or null`);
  }
}

function validateCourse(c: unknown, where: string): void {
  if (!isObject(c)) throw new CoursesFileError(`${where} is not an object`);
  if (typeof c.id !== "number")
    throw new CoursesFileError(`${where}.id missing or not a number`);
  if (typeof c.code !== "string" || c.code.length === 0) {
    throw new CoursesFileError(
      `${where}.code missing or not a non-empty string`,
    );
  }
  if (typeof c.name !== "string")
    throw new CoursesFileError(`${where}.name missing or not a string`);
  if (!isStringOrNull(c.description)) {
    throw new CoursesFileError(`${where}.description not a string or null`);
  }
  if (!isStringOrNull(c.prereqs))
    throw new CoursesFileError(`${where}.prereqs not a string or null`);
  if (!isStringOrNull(c.coreqs))
    throw new CoursesFileError(`${where}.coreqs not a string or null`);
  if (!isStringOrNull(c.antireqs)) {
    throw new CoursesFileError(`${where}.antireqs not a string or null`);
  }
  validateRating(c.rating, `${where}.rating`);
  if (!Array.isArray(c.sections)) {
    throw new CoursesFileError(`${where}.sections is not an array`);
  }
  c.sections.forEach((s, i) => {
    validateSection(s, `${where}.sections[${i}]`);
  });
}

export function validateCoursesFile(raw: unknown): CoursesFile {
  if (!isObject(raw))
    throw new CoursesFileError("top-level value is not an object");
  if (typeof raw.termId !== "number")
    throw new CoursesFileError("termId missing or not a number");
  if (!Array.isArray(raw.courses))
    throw new CoursesFileError("courses is not an array");
  raw.courses.forEach((c, i) => {
    const code =
      isObject(c) && typeof c.code === "string" ? c.code : `index ${i}`;
    validateCourse(c, `courses[${code}]`);
  });
  return raw as unknown as CoursesFile;
}
