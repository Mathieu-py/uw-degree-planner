import { describe, expect, it } from "vitest";
import { toSections } from "../scrape/sources/openData";

// Shape mirrors UW Open Data /ClassSchedules entries.
const sched = (
  classNumber: number,
  courseComponent: string | null,
  cap: number | null,
  enr: number | null,
) => ({
  classNumber,
  courseComponent,
  maxEnrollmentCapacity: cap,
  enrolledStudents: enr,
});

describe("toSections", () => {
  it("keeps only the primary enrolment component (drops TUT/TST)", () => {
    // CS245-like: one LEC, one TST, two TUTs — only the LEC should remain.
    const schedules = [
      sched(5902, "LEC", 110, 95),
      sched(5880, "TST", 110, 95),
      sched(6059, "TUT", 55, 42),
      sched(6471, "TUT", 55, 53),
    ];
    expect(toSections(schedules, "LEC")).toEqual([
      { id: 5902, enrollment_total: 95, enrollment_capacity: 110 },
    ]);
  });

  it("keeps every section of the primary component (multi-LEC)", () => {
    const schedules = [
      sched(1, "LEC", 90, 51),
      sched(2, "LEC", 100, 89),
      sched(9, "TUT", 70, 70),
    ];
    expect(toSections(schedules, "LEC").map((s) => s.id)).toEqual([1, 2]);
  });

  it("honours a non-LEC primary component (e.g. LAB-based course)", () => {
    const schedules = [sched(1, "LAB", 24, 20), sched(2, "LEC", 200, 180)];
    expect(toSections(schedules, "LAB")).toEqual([
      { id: 1, enrollment_total: 20, enrollment_capacity: 24 },
    ]);
  });

  it("falls back to all sections when none match the primary component", () => {
    const schedules = [sched(1, "LEC", 90, 40)];
    // primary says SEM but there's no SEM section → don't lose the data.
    expect(toSections(schedules, "SEM").map((s) => s.id)).toEqual([1]);
  });

  it("drops sections with no numeric capacity", () => {
    const schedules = [sched(1, "LEC", null, 0), sched(2, "LEC", 50, 10)];
    expect(toSections(schedules, "LEC").map((s) => s.id)).toEqual([2]);
  });

  it("defaults a missing enrolled count to 0", () => {
    expect(toSections([sched(1, "LEC", 50, null)], "LEC")).toEqual([
      { id: 1, enrollment_total: 0, enrollment_capacity: 50 },
    ]);
  });
});
