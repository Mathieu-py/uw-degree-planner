import { describe, expect, it } from "vitest";
import {
  DEFAULT_SORT_DIR,
  DEFAULT_SORT_KEY,
  compareCourses,
  parseSortDir,
  parseSortKey,
} from "../sort";
import { enrichCourse } from "../filters";
import type { Course, UWFlowCourse, UWFlowRating } from "../types";

function makeCourse(overrides: Partial<UWFlowCourse> = {}): Course {
  const base: UWFlowCourse = {
    id: 1,
    code: "math116",
    name: "Calculus 1 for Engineering",
    description: null,
    prereqs: null,
    coreqs: null,
    antireqs: null,
    rating: null,
    sections: [],
  };
  return enrichCourse({ ...base, ...overrides });
}

function rating(overrides: Partial<UWFlowRating> = {}): UWFlowRating {
  return { easy: null, useful: null, liked: null, filled_count: null, ...overrides };
}

describe("compareCourses", () => {
  it("sorts by code ascending and descending", () => {
    const a = makeCourse({ code: "cs100" });
    const b = makeCourse({ code: "math116" });
    expect(compareCourses(a, b, "code", "asc")).toBeLessThan(0);
    expect(compareCourses(a, b, "code", "desc")).toBeGreaterThan(0);
  });

  it("sorts by name alphabetically", () => {
    const a = makeCourse({ name: "Algebra" });
    const b = makeCourse({ name: "Zoology" });
    expect(compareCourses(a, b, "name", "asc")).toBeLessThan(0);
  });

  it("sorts numeric columns descending by default direction", () => {
    const high = makeCourse({ rating: rating({ useful: 0.9 }) });
    const low = makeCourse({ rating: rating({ useful: 0.2 }) });
    expect(compareCourses(high, low, "useful", "desc")).toBeLessThan(0);
    expect(compareCourses(high, low, "useful", "asc")).toBeGreaterThan(0);
  });

  it("treats missing ratings as -1 (sorts to the bottom on desc)", () => {
    const rated = makeCourse({ rating: rating({ useful: 0 }) });
    const unrated = makeCourse({ rating: null });
    expect(compareCourses(rated, unrated, "useful", "desc")).toBeLessThan(0);
  });

  it("sorts by seats using seatsAvailable extractor", () => {
    const open = makeCourse({
      sections: [{ id: 1, enrollment_total: 10, enrollment_capacity: 30 }],
    });
    const full = makeCourse({
      sections: [{ id: 2, enrollment_total: 30, enrollment_capacity: 30 }],
    });
    expect(compareCourses(open, full, "seats", "desc")).toBeLessThan(0);
  });
});

describe("parseSortKey", () => {
  it("returns the default when value is missing or unknown", () => {
    expect(parseSortKey(undefined)).toBe(DEFAULT_SORT_KEY);
    expect(parseSortKey("bogus")).toBe(DEFAULT_SORT_KEY);
  });
  it("accepts a known key", () => {
    expect(parseSortKey("easy")).toBe("easy");
    expect(parseSortKey("seats")).toBe("seats");
  });
  it("takes the first element of an array param", () => {
    expect(parseSortKey(["liked", "useful"])).toBe("liked");
  });
});

describe("parseSortDir", () => {
  it("defaults to desc", () => {
    expect(parseSortDir(undefined)).toBe(DEFAULT_SORT_DIR);
    expect(parseSortDir("garbage")).toBe("desc");
  });
  it("returns 'asc' when explicitly set", () => {
    expect(parseSortDir("asc")).toBe("asc");
    expect(parseSortDir(["asc"])).toBe("asc");
  });
});

