import { describe, expect, it } from "vitest";
import {
  assembleServerPlan,
  MAX_COURSES_PER_SLOT,
  MAX_SLOTS,
  mapSharedPlanJson,
  type PlanCourseRow,
  type PlanRow,
  type PlanSlotRow,
  planRowToSummary,
  snapshotSizeError,
  toSnapshot,
} from "../serialize";
import type { PlanSnapshot } from "../types";

function snapshotWith(slots: PlanSnapshot["slots"]): PlanSnapshot {
  return {
    programIds: [],
    specializationIds: {},
    stream: null,
    startTermId: null,
    programScrapeVersion: null,
    slots,
  };
}

function slot(courseCount: number): PlanSnapshot["slots"][number] {
  return {
    id: "s",
    termId: null,
    position: "pre",
    isCoop: false,
    courses: Array.from({ length: courseCount }, (_, i) => ({ code: `c${i}` })),
  };
}

describe("snapshotSizeError", () => {
  it("accepts a normal-sized plan", () => {
    expect(snapshotSizeError(snapshotWith([slot(6), slot(6)]))).toBeNull();
  });

  it("accepts exactly the caps", () => {
    const slots = Array.from({ length: MAX_SLOTS }, () =>
      slot(MAX_COURSES_PER_SLOT),
    );
    expect(snapshotSizeError(snapshotWith(slots))).toBeNull();
  });

  it("rejects too many slots", () => {
    const slots = Array.from({ length: MAX_SLOTS + 1 }, () => slot(0));
    expect(snapshotSizeError(snapshotWith(slots))).toBe("snapshot_too_large");
  });

  it("rejects too many courses in a single slot", () => {
    expect(
      snapshotSizeError(snapshotWith([slot(MAX_COURSES_PER_SLOT + 1)])),
    ).toBe("snapshot_too_large");
  });
});

const PLAN: PlanRow = {
  id: "plan-1",
  name: "My plan",
  program_ids: ["h-software-engineering-beng"],
  specialization_ids: {},
  system_of_study: "stream8",
  start_term_id: 1239,
  program_scrape_version: "2026-05-01",
  share_token: null,
  updated_at: "2026-05-24T12:00:00.000Z",
};

describe("planRowToSummary", () => {
  it("maps snake_case to camelCase and drops slot fields", () => {
    expect(planRowToSummary(PLAN)).toEqual({
      id: "plan-1",
      name: "My plan",
      programIds: ["h-software-engineering-beng"],
      specializationIds: {},
      stream: "stream8",
      startTermId: 1239,
      shareToken: null,
      updatedAt: "2026-05-24T12:00:00.000Z",
    });
  });

  it("surfaces a non-null share_token as shareToken", () => {
    expect(planRowToSummary({ ...PLAN, share_token: "abc123" })).toMatchObject({
      shareToken: "abc123",
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
      programIds: ["h-cs"],
      specializationIds: {},
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
      programIds: ["h-cs"],
      specializationIds: {},
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
      programIds: [],
      specializationIds: {},
      stream: "regular",
      startTermId: null,
      slots: [],
    });
    expect(snap.programScrapeVersion).toBeNull();
  });
});

describe("mapSharedPlanJson", () => {
  // Mirror the shape returned by the `get_shared_plan(token)` RPC defined
  // in supabase/migrations/0001_initial.sql:132-191. Keys are snake_case
  // (Postgres) and slots/courses are pre-ordered by ordinal.
  const RPC_JSON = {
    id: "plan-1",
    name: "Shared plan",
    program_ids: ["h-software-engineering-beng"],
    specialization_ids: { "h-software-engineering-beng": "ai" },
    system_of_study: "stream8",
    start_term_id: 1239,
    program_scrape_version: "2026-05-01",
    updated_at: "2026-05-24T12:00:00.000Z",
    slots: [
      {
        id: "s1",
        term_id: 1239,
        position: "1A",
        is_coop: false,
        ordinal: 0,
        courses: [
          { code: "cs115", grade: "87", ordinal: 0 },
          { code: "math115", grade: null, ordinal: 1 },
        ],
      },
      {
        id: "s2",
        term_id: 1245,
        position: "1B",
        is_coop: false,
        ordinal: 1,
        courses: [],
      },
    ],
  };

  it("returns null for null/undefined input", () => {
    expect(mapSharedPlanJson(null)).toBeNull();
    expect(mapSharedPlanJson(undefined)).toBeNull();
  });

  it("maps snake_case to camelCase across plan, slots, and courses", () => {
    const result = mapSharedPlanJson(RPC_JSON);
    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      id: "plan-1",
      name: "Shared plan",
      programIds: ["h-software-engineering-beng"],
      specializationIds: { "h-software-engineering-beng": "ai" },
      stream: "stream8",
      startTermId: 1239,
      programScrapeVersion: "2026-05-01",
      updatedAt: "2026-05-24T12:00:00.000Z",
    });
    expect(result?.slots).toEqual([
      {
        id: "s1",
        termId: 1239,
        position: "1A",
        isCoop: false,
        courses: [{ code: "cs115", grade: "87" }, { code: "math115" }],
      },
      {
        id: "s2",
        termId: 1245,
        position: "1B",
        isCoop: false,
        courses: [],
      },
    ]);
  });

  it("omits the grade field on SlotCourse when null (matches read-path semantics)", () => {
    const result = mapSharedPlanJson({
      ...RPC_JSON,
      slots: [
        {
          ...RPC_JSON.slots[0],
          courses: [{ code: "cs115", grade: null, ordinal: 0 }],
        },
      ],
    });
    const course = result?.slots[0].courses[0];
    expect(course).toEqual({ code: "cs115" });
    expect(course && "grade" in course).toBe(false);
  });

  it("trusts the RPC's slot/course ordering (no client-side resort)", () => {
    // The RPC orders by ordinal before serializing; the mapper must not
    // re-order, so an out-of-order payload (defensively constructed here)
    // should round-trip as-is. If the RPC ever ships unsorted, that's an
    // RPC bug, not a mapper concern.
    const result = mapSharedPlanJson({
      ...RPC_JSON,
      slots: [RPC_JSON.slots[1], RPC_JSON.slots[0]],
    });
    expect(result?.slots.map((s) => s.id)).toEqual(["s2", "s1"]);
  });

  it("throws on non-object input so callers see the shape mismatch early", () => {
    expect(() => mapSharedPlanJson("not json")).toThrow();
    expect(() => mapSharedPlanJson(42)).toThrow();
  });
});
