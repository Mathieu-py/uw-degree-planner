import { describe, expect, it } from "vitest";
import {
  assembleServerPlan,
  type PlanCourseRow,
  type PlanRow,
  type PlanSlotRow,
  planRowToSummary,
  toSnapshot,
} from "../serialize";

const PLAN: PlanRow = {
  id: "plan-1",
  name: "My plan",
  program_id: "h-software-engineering-beng",
  specialization_id: null,
  system_of_study: "stream8",
  start_term_id: 1239,
  program_scrape_version: "2026-05-01",
  updated_at: "2026-05-24T12:00:00.000Z",
};

describe("planRowToSummary", () => {
  it("maps snake_case to camelCase and drops slot fields", () => {
    expect(planRowToSummary(PLAN)).toEqual({
      id: "plan-1",
      name: "My plan",
      programId: "h-software-engineering-beng",
      specializationId: null,
      stream: "stream8",
      startTermId: 1239,
      updatedAt: "2026-05-24T12:00:00.000Z",
    });
  });
});

describe("assembleServerPlan", () => {
  it("orders slots by ordinal asc, then by id for ties", () => {
    const slots: PlanSlotRow[] = [
      {
        id: "b",
        plan_id: "plan-1",
        term_id: 1245,
        position: "1B",
        is_coop: false,
        ordinal: 1,
      },
      {
        id: "a",
        plan_id: "plan-1",
        term_id: 1239,
        position: "1A",
        is_coop: false,
        ordinal: 0,
      },
    ];
    const result = assembleServerPlan(PLAN, slots, []);
    expect(result.slots.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("orders courses within a slot by ordinal", () => {
    const slots: PlanSlotRow[] = [
      {
        id: "s1",
        plan_id: "plan-1",
        term_id: 1239,
        position: "1A",
        is_coop: false,
        ordinal: 0,
      },
    ];
    const courses: PlanCourseRow[] = [
      {
        id: "c2",
        slot_id: "s1",
        course_code: "math115",
        grade: null,
        ordinal: 1,
      },
      {
        id: "c1",
        slot_id: "s1",
        course_code: "cs115",
        grade: "87",
        ordinal: 0,
      },
    ];
    const result = assembleServerPlan(PLAN, slots, courses);
    expect(result.slots[0].courses).toEqual([
      { code: "cs115", grade: "87" },
      { code: "math115" },
    ]);
  });

  it("omits the grade field on SlotCourse when the DB grade is null", () => {
    const slots: PlanSlotRow[] = [
      {
        id: "s1",
        plan_id: "plan-1",
        term_id: 1239,
        position: "1A",
        is_coop: false,
        ordinal: 0,
      },
    ];
    const courses: PlanCourseRow[] = [
      {
        id: "c1",
        slot_id: "s1",
        course_code: "cs115",
        grade: null,
        ordinal: 0,
      },
    ];
    const result = assembleServerPlan(PLAN, slots, courses);
    expect(result.slots[0].courses[0]).toEqual({ code: "cs115" });
    expect("grade" in result.slots[0].courses[0]).toBe(false);
  });

  it("preserves an empty-string grade rather than dropping the field", () => {
    // The save RPC normalizes '' to null via `nullif(..., '')`, so this case
    // should never originate from our own writes — but the read path must not
    // assume that. If a row somehow has grade='' the field should round-trip.
    const slots: PlanSlotRow[] = [
      {
        id: "s1",
        plan_id: "plan-1",
        term_id: 1239,
        position: "1A",
        is_coop: false,
        ordinal: 0,
      },
    ];
    const courses: PlanCourseRow[] = [
      {
        id: "c1",
        slot_id: "s1",
        course_code: "cs115",
        grade: "",
        ordinal: 0,
      },
    ];
    const result = assembleServerPlan(PLAN, slots, courses);
    expect(result.slots[0].courses[0]).toEqual({ code: "cs115", grade: "" });
  });

  it("returns slots with empty courses array when no courses match", () => {
    const slots: PlanSlotRow[] = [
      {
        id: "s1",
        plan_id: "plan-1",
        term_id: 1239,
        position: "1A",
        is_coop: false,
        ordinal: 0,
      },
      {
        id: "s2",
        plan_id: "plan-1",
        term_id: 1245,
        position: "1B",
        is_coop: false,
        ordinal: 1,
      },
    ];
    const result = assembleServerPlan(PLAN, slots, []);
    expect(result.slots).toHaveLength(2);
    expect(result.slots[0].courses).toEqual([]);
    expect(result.slots[1].courses).toEqual([]);
  });

  it("preserves plan metadata (id, name, programScrapeVersion, updatedAt)", () => {
    const result = assembleServerPlan(PLAN, [], []);
    expect(result.id).toBe("plan-1");
    expect(result.name).toBe("My plan");
    expect(result.programScrapeVersion).toBe("2026-05-01");
    expect(result.updatedAt).toBe("2026-05-24T12:00:00.000Z");
  });
});

describe("toSnapshot", () => {
  it("strips server-managed fields (id, name, updatedAt)", () => {
    const snap = toSnapshot({
      programId: "h-cs",
      specializationId: null,
      stream: "regular",
      startTermId: 1239,
      programScrapeVersion: "2026-05-01",
      slots: [
        {
          id: "s1",
          termId: 1239,
          position: "1A",
          isCoop: false,
          courses: [{ code: "cs115" }],
        },
      ],
    });
    expect(snap).toEqual({
      programId: "h-cs",
      specializationId: null,
      stream: "regular",
      startTermId: 1239,
      programScrapeVersion: "2026-05-01",
      slots: [
        {
          id: "s1",
          termId: 1239,
          position: "1A",
          isCoop: false,
          courses: [{ code: "cs115" }],
        },
      ],
    });
    // No id / name / updatedAt smuggled in.
    expect("id" in snap).toBe(false);
    expect("name" in snap).toBe(false);
    expect("updatedAt" in snap).toBe(false);
  });

  it("defaults programScrapeVersion to null when absent on input", () => {
    const snap = toSnapshot({
      programId: null,
      specializationId: null,
      stream: "regular",
      startTermId: null,
      slots: [],
    });
    expect(snap.programScrapeVersion).toBeNull();
  });
});
