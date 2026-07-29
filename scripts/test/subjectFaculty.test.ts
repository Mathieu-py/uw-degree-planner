import { describe, expect, it } from "vitest";
import type { Faculty } from "../../lib/programs";
import {
  facultyFromName,
  OMITTED_SUBJECTS,
  SUBJECT_FACULTY,
  subjectsForFaculties,
} from "../scrape/util/subjectFaculty";

// The six real UW faculties a "Faculty of X" pool can name. Interdisciplinary /
// affiliated owners (SE, PD, STV, BUS, …) are intentionally NOT faculties here.
const FACULTIES: Faculty[] = [
  "mathematics",
  "engineering",
  "science",
  "arts",
  "health",
  "environment",
];

describe("subjectsForFaculties — no faculty silently resolves to an empty pool", () => {
  // Guard: a faculty that mapped to zero subjects would make a
  // "Faculty of X" pool expand to nothing and silently drop the whole
  // requirement. Each real faculty must own several subject codes, so a future
  // edit that empties one is caught here instead of quietly under-crediting.
  it.each(FACULTIES)("%s owns mapped subjects", (faculty) => {
    expect(subjectsForFaculties([faculty]).length).toBeGreaterThan(2);
  });

  it("resolves each faculty NAME to a non-empty pool", () => {
    for (const name of [
      "Faculty of Mathematics",
      "Faculty of Engineering",
      "Faculty of Science",
      "Faculty of Arts",
      "Faculty of Health",
      "Faculty of Environment",
    ]) {
      const f = facultyFromName(name);
      expect(f).not.toBeNull();
      expect(subjectsForFaculties([f as Faculty]).length).toBeGreaterThan(0);
    }
  });
});

describe("SUBJECT_FACULTY — data integrity", () => {
  const entries = Object.entries(SUBJECT_FACULTY);

  it("keys are all lowercase (poolMatch/coursePrefix compare lowercase)", () => {
    for (const [key] of entries) expect(key).toBe(key.toLowerCase());
  });

  it("omits subjects whose owner isn't a single faculty", () => {
    // OMITTED_SUBJECTS (Interdisciplinary Studies, Wilfrid Laurier, Renison) must
    // never leak into the map, or a "Faculty of X" pool would wrongly claim them.
    for (const omitted of OMITTED_SUBJECTS)
      expect(Object.hasOwn(SUBJECT_FACULTY, omitted)).toBe(false);
  });

  it("every value is one of the six real faculties", () => {
    const valid = new Set<Faculty>(FACULTIES);
    for (const [, faculty] of entries) expect(valid.has(faculty)).toBe(true);
  });

  // NOTE: key uniqueness is NOT runtime-testable — a JS object literal silently
  // drops duplicate keys, so `Object.keys` is already deduped here. Biome's
  // noDuplicateObjectKeys catches duplicates in the source instead.
});
