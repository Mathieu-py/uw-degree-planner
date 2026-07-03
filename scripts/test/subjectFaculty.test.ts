import { describe, expect, it } from "vitest";
import type { Faculty } from "../../lib/programs";
import {
  facultyFromName,
  subjectsForFaculties,
} from "../scrape/data/subjectFaculty";

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
  // Guard (#10): a faculty that mapped to zero subjects would make a
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
