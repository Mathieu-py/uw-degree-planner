import { describe, expect, it } from "vitest";
import {
  assembleServerPlan,
  mapSharedPlanJson,
  type PlanCourseRow,
  type PlanRow,
  type PlanSlotRow,
  planRowToSummary,
  toSnapshot,
} from "../serialize";
import { snapshotError } from "../validate";

const PLAN: PlanRow = {
  id: "plan-1",
  name: "My plan",
  program_ids: ["h-software-engineering-beng"],
  specialization_ids: {},
  acknowledged_requirements: {},
  system_of_study: "stream8",
  start_term_id: 1239,
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
        outcome: null,
        ordinal: 1,
      },
      {
        id: "c1",
        slot_id: "s1",
        course_code: "cs115",
        outcome: "credit",
        ordinal: 0,
      },
    ];
    const result = assembleServerPlan(PLAN, slots, courses);
    expect(result.slots[0].courses).toEqual([
      { code: "cs115", outcome: "credit" },
      { code: "math115" },
    ]);
  });

  it("omits the outcome field on SlotCourse when the DB outcome is null", () => {
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
        outcome: null,
        ordinal: 0,
      },
    ];
    const result = assembleServerPlan(PLAN, slots, courses);
    expect(result.slots[0].courses[0]).toEqual({ code: "cs115" });
    expect("outcome" in result.slots[0].courses[0]).toBe(false);
  });

  it("drops a non-enum outcome from the DB", () => {
    // The column CHECK makes this unreachable from our own writes; the read
    // path still degrades to planned rather than propagating a bad value.
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
        outcome: "87",
        ordinal: 0,
      },
    ];
    const result = assembleServerPlan(PLAN, slots, courses);
    expect(result.slots[0].courses[0]).toEqual({ code: "cs115" });
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

  it("preserves plan metadata (id, name, updatedAt)", () => {
    const result = assembleServerPlan(PLAN, [], []);
    expect(result.id).toBe("plan-1");
    expect(result.name).toBe("My plan");
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
      acknowledgedRequirements: {},
      stream: "regular",
      startTermId: 1239,
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

  it("clamps an over-cap acknowledgement so one bad entry doesn't fail the whole save (#11)", () => {
    const long = "x".repeat(600); // exceeds MAX_ACKED_TEXT_LEN (512)
    const snap = toSnapshot({
      programIds: ["h-cs"],
      specializationIds: {},
      acknowledgedRequirements: {
        "h-cs": ["A real acknowledged requirement.", long],
      },
      stream: "regular",
      startTermId: null,
      slots: [],
    });
    // The over-long text is dropped; the valid one survives, and the snapshot
    // now passes validation instead of the whole plan silently failing to save.
    expect(snap.acknowledgedRequirements).toEqual({
      "h-cs": ["A real acknowledged requirement."],
    });
    expect(snapshotError(snap)).toBeNull();
    // Sanity: the same snapshot WITH the raw over-long text would be rejected.
    expect(
      snapshotError({ ...snap, acknowledgedRequirements: { "h-cs": [long] } }),
    ).toBe("invalid_snapshot");
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
    updated_at: "2026-05-24T12:00:00.000Z",
    slots: [
      {
        id: "s1",
        term_id: 1239,
        position: "1A",
        is_coop: false,
        ordinal: 0,
        courses: [
          { code: "cs115", outcome: "credit", ordinal: 0 },
          { code: "math115", outcome: null, ordinal: 1 },
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
      updatedAt: "2026-05-24T12:00:00.000Z",
    });
    expect(result?.slots).toEqual([
      {
        id: "s1",
        termId: 1239,
        position: "1A",
        isCoop: false,
        courses: [{ code: "cs115", outcome: "credit" }, { code: "math115" }],
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

  it("omits the outcome field on SlotCourse when null (matches read-path semantics)", () => {
    const result = mapSharedPlanJson({
      ...RPC_JSON,
      slots: [
        {
          ...RPC_JSON.slots[0],
          courses: [{ code: "cs115", outcome: null, ordinal: 0 }],
        },
      ],
    });
    const course = result?.slots[0].courses[0];
    expect(course).toEqual({ code: "cs115" });
    expect(course && "outcome" in course).toBe(false);
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

  it("preserves multi-program order on the shared-plan round trip", () => {
    // Selected program order is meaningful (programIds[0] is the display
    // primary), so the snake_case→camelCase map must not re-order it.
    const result = mapSharedPlanJson({
      ...RPC_JSON,
      program_ids: ["h-cs", "h-stats", "h-math-econ"],
    });
    expect(result?.programIds).toEqual(["h-cs", "h-stats", "h-math-econ"]);
  });
});

describe("toStringArrayRecord (via acknowledgedRequirements coercion)", () => {
  // The helper is internal; exercise it through the public read paths that map
  // the `acknowledged_requirements` jsonb column into `ServerPlan`. Crafting the
  // raw value lets us assert the defensive coercion without exporting it.
  const ackFromShared = (v: unknown) =>
    mapSharedPlanJson({ acknowledged_requirements: v })
      ?.acknowledgedRequirements;

  it("coerces null to an empty record", () => {
    expect(ackFromShared(null)).toEqual({});
  });

  it("coerces a non-object (string) to an empty record", () => {
    expect(ackFromShared("nope")).toEqual({});
  });

  it("coerces a top-level array to an empty record", () => {
    expect(ackFromShared(["a", "b"])).toEqual({});
  });

  it("drops keys whose value isn't an array", () => {
    expect(ackFromShared({ p: "not an array", q: 3 })).toEqual({});
  });

  it("stringifies array elements", () => {
    expect(ackFromShared({ p: ["x", 1, true] })).toEqual({
      p: ["x", "1", "true"],
    });
  });

  it("filters out empty strings and drops a key that empties out (Fix 2)", () => {
    expect(ackFromShared({ p: ["", "real", ""], q: [""] })).toEqual({
      p: ["real"],
    });
  });

  it("keeps only the valid keys from a mixed record", () => {
    expect(
      ackFromShared({ good: ["x"], notArray: "nope", emptied: [""] }),
    ).toEqual({ good: ["x"] });
  });

  it("applies the same coercion on the authenticated read path (assembleServerPlan)", () => {
    const plan = assembleServerPlan(
      { ...PLAN, acknowledged_requirements: { p: ["", "real"] } },
      [],
      [],
    );
    expect(plan.acknowledgedRequirements).toEqual({ p: ["real"] });
  });
});
