import { describe, expect, it } from "vitest";
import type { Course } from "@/lib/courses/types";
import type { LocalPlan, SlotPosition } from "@/lib/plan/types";
import { buildProgramAudit } from "../buildProgramAudit";

/**
 * Per-program audit bounding (#105). A Three-Year General program spans 6 terms
 * (1A–3B). On a multi-program timeline that runs the full 8 terms, a course
 * placed in 4A/4B must NOT credit the 3-year leg — those terms are past its span.
 */

const EMPTY_CATALOG = new Map<string, Course>();
const THREE_YEAR = "3g-anthropology"; // numberOfTerms = 6
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

describe("audit bounding to program span", () => {
  it("credits a required course placed within the 6-term span (3A)", () => {
    const data = buildProgramAudit(
      planWithCourseAt("3A"),
      THREE_YEAR,
      EMPTY_CATALOG,
      [],
    );
    expect(data.placedCodes.has(REQUIRED)).toBe(true);
  });

  it("ignores the same course placed past the span (4A)", () => {
    const data = buildProgramAudit(
      planWithCourseAt("4A"),
      THREE_YEAR,
      EMPTY_CATALOG,
      [],
    );
    expect(data.placedCodes.has(REQUIRED)).toBe(false);
  });

  it("surfaces a course dropped past the span so the exclusion isn't silent (#7)", () => {
    const data = buildProgramAudit(
      planWithCourseAt("4A"),
      THREE_YEAR,
      EMPTY_CATALOG,
      [],
    );
    expect(data.outOfSpanCodes).toContain(REQUIRED);
  });

  it("reports no out-of-span courses when everything fits the span", () => {
    const data = buildProgramAudit(
      planWithCourseAt("3A"),
      THREE_YEAR,
      EMPTY_CATALOG,
      [],
    );
    expect(data.outOfSpanCodes).toEqual([]);
  });

  it("placing past the span credits strictly less than within it", () => {
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
    expect(pastSpan.progress.creditedUnits).toBeLessThan(
      inSpan.progress.creditedUnits,
    );
  });
});
