import { beforeEach, describe, expect, it, vi } from "vitest";

// data.ts is server-only and reads snapshots off disk. Stub the `server-only`
// import guard (it throws outside a server bundle) and mock fs so we can drive
// the read/parse failure paths without touching the real data/ files.
vi.mock("server-only", () => ({}));

const { readFileMock } = vi.hoisted(() => ({ readFileMock: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readFile: readFileMock }));

import { CourseDataError, loadTerm } from "../data";
import { CoursesFileError } from "../validation";

function validFileJson(termId: number) {
  return JSON.stringify({
    termId,
    fetchedAt: "2026-05-14T00:00:00Z",
    courseCount: 1,
    courses: [
      {
        id: 1,
        code: "cs115",
        name: "Intro CS",
        prereqs: null,
        coreqs: null,
        antireqs: null,
        rating: null,
        sections: [],
      },
    ],
  });
}

describe("loadTerm", () => {
  beforeEach(() => {
    readFileMock.mockReset();
  });

  it("throws CourseDataError when the snapshot file is missing", async () => {
    const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    readFileMock.mockRejectedValueOnce(err);
    // Distinct termId per case so React's cache() can't return a memoized result.
    await expect(loadTerm(9001 as never)).rejects.toBeInstanceOf(
      CourseDataError,
    );
  });

  it("throws CourseDataError when the file is not valid JSON", async () => {
    readFileMock.mockResolvedValueOnce("{ not json");
    await expect(loadTerm(9002 as never)).rejects.toBeInstanceOf(
      CourseDataError,
    );
  });

  it("throws CoursesFileError when JSON is well-formed but the wrong shape", async () => {
    readFileMock.mockResolvedValueOnce(JSON.stringify({ termId: 9003 }));
    await expect(loadTerm(9003 as never)).rejects.toBeInstanceOf(
      CoursesFileError,
    );
  });

  it("returns enriched courses for a valid snapshot", async () => {
    readFileMock.mockResolvedValueOnce(validFileJson(9004));
    const courses = await loadTerm(9004 as never);
    expect(courses).toHaveLength(1);
    expect(courses[0].code).toBe("cs115");
  });
});
