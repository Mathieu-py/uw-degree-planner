// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Course } from "@/lib/types";
import { PICKER_PAGE_SIZE, useFilteredCourses } from "../useFilteredCourses";

function mkCourse(
  code: string,
  name: string,
  useful: number | null = 0.8,
): Course {
  const prefix = (code.match(/^[a-z]+/i)?.[0] ?? "").toUpperCase();
  const level = Math.floor(Number(code.replace(/[^\d]/g, "") || 0) / 100) * 100;
  return {
    id: code.length + name.length,
    code,
    name,
    description: null,
    prereqs: null,
    coreqs: null,
    antireqs: null,
    rating: { useful, easy: 0.5, liked: 0.5, filled_count: 10 },
    sections: [],
    prefix,
    level,
    hasSeats: true,
  };
}

const CATALOG: Course[] = [
  mkCourse("cs115", "Intro to CS", 0.9),
  mkCourse("cs136", "Algorithm Design", 0.85),
  mkCourse("math115", "Linear Algebra", 0.7),
  mkCourse("math135", "Algebra", 0.6),
  mkCourse("phys121", "Mechanics", 0.5),
];

const NO_PLACED = new Set<string>();
const NO_COMPLETED = new Set<string>();

describe("useFilteredCourses — narrowing", () => {
  it("excludes already-placed codes", () => {
    const { result } = renderHook(() =>
      useFilteredCourses({
        catalog: CATALOG,
        placedCodes: new Set(["cs115"]),
        completedBefore: NO_COMPLETED,
      }),
    );
    const codes = result.current.sorted.map((r) => r.course.code);
    expect(codes).not.toContain("cs115");
    expect(codes).toContain("cs136");
  });

  it("restricts to focusCodes when provided", () => {
    const { result } = renderHook(() =>
      useFilteredCourses({
        catalog: CATALOG,
        placedCodes: NO_PLACED,
        completedBefore: NO_COMPLETED,
        focusCodes: ["math115", "math135"],
      }),
    );
    const codes = result.current.sorted.map((r) => r.course.code).sort();
    expect(codes).toEqual(["math115", "math135"]);
  });

  it("filters out a placed code even when listed in focusCodes", () => {
    const { result } = renderHook(() =>
      useFilteredCourses({
        catalog: CATALOG,
        placedCodes: new Set(["math115"]),
        completedBefore: NO_COMPLETED,
        focusCodes: ["math115", "math135"],
      }),
    );
    const codes = result.current.sorted.map((r) => r.course.code);
    expect(codes).toEqual(["math135"]);
  });
});

describe("useFilteredCourses — query search", () => {
  it("narrows by free-text matching code or name", () => {
    const { result } = renderHook(() =>
      useFilteredCourses({
        catalog: CATALOG,
        placedCodes: NO_PLACED,
        completedBefore: NO_COMPLETED,
      }),
    );

    act(() => result.current.patchFilters({ query: "math" }));
    const codes = result.current.sorted.map((r) => r.course.code).sort();
    expect(codes).toEqual(["math115", "math135"]);
  });

  it("matches against course name as well as code", () => {
    const { result } = renderHook(() =>
      useFilteredCourses({
        catalog: CATALOG,
        placedCodes: NO_PLACED,
        completedBefore: NO_COMPLETED,
      }),
    );

    act(() => result.current.patchFilters({ query: "mechanics" }));
    const codes = result.current.sorted.map((r) => r.course.code);
    expect(codes).toEqual(["phys121"]);
  });
});

describe("useFilteredCourses — sort", () => {
  it("flips direction when the same column is selected twice", () => {
    const { result } = renderHook(() =>
      useFilteredCourses({
        catalog: CATALOG,
        placedCodes: NO_PLACED,
        completedBefore: NO_COMPLETED,
      }),
    );

    act(() => result.current.onSort("code"));
    const firstDir = result.current.sortDir;
    act(() => result.current.onSort("code"));
    expect(result.current.sortDir).not.toBe(firstDir);
  });

  it("default sort (useful desc) puts the highest-rated course first", () => {
    const { result } = renderHook(() =>
      useFilteredCourses({
        catalog: CATALOG,
        placedCodes: NO_PLACED,
        completedBefore: NO_COMPLETED,
      }),
    );

    expect(result.current.sortKey).toBe("useful");
    expect(result.current.sortDir).toBe("desc");
    expect(result.current.sorted[0].course.code).toBe("cs115");
  });

  it("switching to a different numeric column defaults to desc", () => {
    const { result } = renderHook(() =>
      useFilteredCourses({
        catalog: CATALOG,
        placedCodes: NO_PLACED,
        completedBefore: NO_COMPLETED,
      }),
    );

    act(() => result.current.onSort("easy"));
    expect(result.current.sortKey).toBe("easy");
    expect(result.current.sortDir).toBe("desc");
  });

  it("switching to a text column defaults to asc", () => {
    const { result } = renderHook(() =>
      useFilteredCourses({
        catalog: CATALOG,
        placedCodes: NO_PLACED,
        completedBefore: NO_COMPLETED,
      }),
    );

    act(() => result.current.onSort("code"));
    expect(result.current.sortKey).toBe("code");
    expect(result.current.sortDir).toBe("asc");
  });
});

describe("useFilteredCourses — pagination", () => {
  it("limits visible rows to PICKER_PAGE_SIZE and exposes hasMore", () => {
    const many: Course[] = Array.from(
      { length: PICKER_PAGE_SIZE + 10 },
      (_, i) => mkCourse(`xx${100 + i}`, `Course ${i}`),
    );
    const { result } = renderHook(() =>
      useFilteredCourses({
        catalog: many,
        placedCodes: NO_PLACED,
        completedBefore: NO_COMPLETED,
      }),
    );

    expect(result.current.visible).toHaveLength(PICKER_PAGE_SIZE);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.sorted.length).toBe(PICKER_PAGE_SIZE + 10);
  });

  it("showMore expands the visible window", () => {
    const many: Course[] = Array.from(
      { length: PICKER_PAGE_SIZE + 10 },
      (_, i) => mkCourse(`xx${100 + i}`, `Course ${i}`),
    );
    const { result } = renderHook(() =>
      useFilteredCourses({
        catalog: many,
        placedCodes: NO_PLACED,
        completedBefore: NO_COMPLETED,
      }),
    );

    act(() => result.current.showMore());
    expect(result.current.visible).toHaveLength(PICKER_PAGE_SIZE + 10);
    expect(result.current.hasMore).toBe(false);
  });

  it("changing a filter resets pagination", () => {
    const many: Course[] = Array.from(
      { length: PICKER_PAGE_SIZE + 10 },
      (_, i) => mkCourse(`xx${100 + i}`, `Course ${i}`),
    );
    const { result } = renderHook(() =>
      useFilteredCourses({
        catalog: many,
        placedCodes: NO_PLACED,
        completedBefore: NO_COMPLETED,
      }),
    );

    act(() => result.current.showMore()); // page 2
    act(() => result.current.patchFilters({ query: "xx" }));
    expect(result.current.visible.length).toBeLessThanOrEqual(PICKER_PAGE_SIZE);
  });
});

describe("useFilteredCourses — resetFilters", () => {
  it("clears query, sort, and pagination", () => {
    const { result } = renderHook(() =>
      useFilteredCourses({
        catalog: CATALOG,
        placedCodes: NO_PLACED,
        completedBefore: NO_COMPLETED,
      }),
    );

    act(() => result.current.patchFilters({ query: "math" }));
    act(() => result.current.onSort("useful"));
    act(() => result.current.resetFilters());

    expect(result.current.filters.query).toBe("");
    expect(result.current.sortKey).toBe("useful");
    // After reset, sort key is the default; verify behavior by sorted output
    // matching the no-filter view.
    expect(result.current.sorted).toHaveLength(CATALOG.length);
  });
});
