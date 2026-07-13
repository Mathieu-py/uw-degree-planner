import { describe, expect, it } from "vitest";
import type { Course } from "@/lib/courses/types";
import type { LocalPlan, SlotPosition } from "@/lib/plan/types";
import { buildProgramAudit } from "../buildProgramAudit";

/**
 * Degree credit is term-agnostic. The UW Undergraduate Calendar defines an
 * academic plan as "a defined set of requirements that leads to a particular
 * credential" (Glossary of Terms) and ties credit to completing those
 * requirements, not to the term a course is taken in. So a required course
 * credits its program wherever it sits on the timeline — including terms past a
 * short program's nominal length on a mixed double-degree grid. (Replaces the
 * former term-span gate, which was not calendar-backed.)
 */

const EMPTY_CATALOG = new Map<string, Course>();
const THREE_YEAR = "3g-anthropology"; // 6-term Three-Year General
// anth204 is a required course of the Anthropology Three-Year General program.
const REQUIRED = "anth204";

/** Full 8-term plan with `REQUIRED` placed in a single slot at `position`. */
function planWithCourseAt(position: SlotPosition): LocalPlan {
  const order: SlotPosition[] = [
    "1A",
    "1B",
    "2A",
    "2B",
    "3A",
    "3B",
    "4A",
    "4B",
  ];
  return {
    schemaVersion: 3,
    programIds: [THREE_YEAR],
    specializationIds: {},
    stream: "regular",
    startTermId: 1239,
    slots: order.map((p, i) => ({
      id: `s-${p}`,
      termId: 1239 + i,
      position: p,
      isCoop: false,
      courses: p === position ? [{ code: REQUIRED }] : [],
    })),
    updatedAt: "2026-06-10T12:00:00.000Z",
  };
}

describe("term-agnostic degree credit", () => {
  it("credits a required course placed within the nominal span (3A)", () => {
    const data = buildProgramAudit(
      planWithCourseAt("3A"),
      THREE_YEAR,
      EMPTY_CATALOG,
      [],
    );
    expect(data.placedCodes.has(REQUIRED)).toBe(true);
  });

  it("credits the same course placed past the nominal span (4A)", () => {
    const data = buildProgramAudit(
      planWithCourseAt("4A"),
      THREE_YEAR,
      EMPTY_CATALOG,
      [],
    );
    expect(data.placedCodes.has(REQUIRED)).toBe(true);
  });

  it("credits the same units regardless of term placed (3A vs 4A)", () => {
    const inSpan = buildProgramAudit(
      planWithCourseAt("3A"),
      THREE_YEAR,
      EMPTY_CATALOG,
      [],
    );
    const pastSpan = buildProgramAudit(
      planWithCourseAt("4A"),
      THREE_YEAR,
      EMPTY_CATALOG,
      [],
    );
    expect(pastSpan.progress.creditedUnits).toBe(inSpan.progress.creditedUnits);
    expect(pastSpan.progress.creditedUnits).toBeGreaterThan(0);
  });
});
