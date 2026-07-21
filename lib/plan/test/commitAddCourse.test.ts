import { afterEach, describe, expect, it, vi } from "vitest";
import type { Course } from "@/lib/courses/types";
import type { PlanSnapshot, ServerPlan } from "@/lib/plan/server/types";
import type { LocalPlan, PlanSlot } from "@/lib/plan/types";
import type { ActionResult } from "@/lib/server/actions";
import { makeTermId } from "@/lib/terms";

// Mock the only side-effecting deps so the add logic runs for real; the real
// server actions pull in `server-only`, which throws under the test runner.
const { loadServerPlanMock, savePlanStateMock, loadPlanMock, savePlanMock } =
  vi.hoisted(() => ({
    loadServerPlanMock:
      vi.fn<(planId: string) => Promise<ActionResult<ServerPlan | null>>>(),
    savePlanStateMock:
      vi.fn<
        (planId: string, snapshot: PlanSnapshot) => Promise<ActionResult<void>>
      >(),
    loadPlanMock: vi.fn<() => LocalPlan | null>(),
    savePlanMock: vi.fn<(plan: LocalPlan) => boolean>(() => true),
  }));
vi.mock("@/lib/plan/server/actions", () => ({
  loadServerPlan: loadServerPlanMock,
  savePlanState: savePlanStateMock,
}));
vi.mock("@/lib/plan/storage", () => ({
  loadPlan: loadPlanMock,
  savePlan: savePlanMock,
}));

import { programDetail } from "@/lib/programs/detail";
import { PROGRAMS } from "@/lib/programs/registry";
import {
  type ApplyAddResult,
  applyAddToPlan,
  commitAddCourse,
  runAddToPlanState,
} from "../commitAddCourse";

// Prime ONLY SYDE: the blocked test needs a resolvable verdict; the unresolved
// test relies on another program staying unloadable.
programDetail.prime({
  "systems-design-engineering": PROGRAMS["systems-design-engineering"],
});

const FALL = makeTermId(2025, "Fall"); // 1259 → "Fall 2025"
const WINTER = makeTermId(2025, "Winter"); // 1251 → "Winter 2025"

function slot(over: Partial<PlanSlot> & { id: string }): PlanSlot {
  return { termId: null, position: "1A", isCoop: false, courses: [], ...over };
}

// Minimal catalog course; commitAddCourse only reads `code` (+ `prereqs`/
// `crossListed` through the shared eligibility gate), so the rest are inert.
function makeCourse(code: string, over: Partial<Course> = {}): Course {
  return {
    id: 0,
    code,
    name: code,
    prereqs: null,
    coreqs: null,
    antireqs: null,
    rating: null,
    sections: [],
    prefix: "",
    level: 0,
    hasSeats: false,
    ...over,
  };
}

function localPlan(slots: PlanSlot[]): LocalPlan {
  return {
    schemaVersion: 3,
    programIds: ["se"],
    specializationIds: {},
    stream: "regular",
    startTermId: FALL,
    slots,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function serverPlan(slots: PlanSlot[]): ServerPlan {
  return {
    id: "plan-1",
    name: "My plan",
    programIds: ["se"],
    specializationIds: {},
    acknowledgedRequirements: {},
    stream: "regular",
    startTermId: FALL,
    programScrapeVersion: null,
    slots,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

afterEach(() => {
  vi.clearAllMocks();
  savePlanMock.mockReturnValue(true);
});

describe("commitAddCourse — signed-out (local)", () => {
  it("adds to the slot matching the term, lowercasing the code", async () => {
    loadPlanMock.mockReturnValue(
      localPlan([
        slot({ id: "a", position: "1A", termId: FALL }),
        slot({ id: "b", position: "1B", termId: WINTER }),
      ]),
    );
    const res = await commitAddCourse({
      isAuthed: false,
      planId: null,
      term: WINTER,
      course: makeCourse("CS246"),
    });
    expect(res).toEqual({ status: "added", termLabel: "Winter 2025" });
    const saved = savePlanMock.mock.calls[0][0] as LocalPlan;
    expect(
      saved.slots.find((s) => s.id === "b")?.courses.map((c) => c.code),
    ).toEqual(["cs246"]);
    // The other term is untouched.
    expect(saved.slots.find((s) => s.id === "a")?.courses).toEqual([]);
  });

  it("reports already-placed (with its term label) and does not save", async () => {
    loadPlanMock.mockReturnValue(
      localPlan([
        slot({
          id: "a",
          position: "1A",
          termId: FALL,
          courses: [{ code: "cs246" }],
        }),
        slot({ id: "b", position: "1B", termId: WINTER }),
      ]),
    );
    const res = await commitAddCourse({
      isAuthed: false,
      planId: null,
      term: WINTER,
      course: makeCourse("cs246"),
    });
    expect(res).toEqual({ status: "already-placed", label: "Fall 2025" });
    expect(savePlanMock).not.toHaveBeenCalled();
  });

  it("is unresolved when the term maps to no slot", async () => {
    loadPlanMock.mockReturnValue(
      localPlan([slot({ id: "a", position: "1A", termId: FALL })]),
    );
    const res = await commitAddCourse({
      isAuthed: false,
      planId: null,
      term: WINTER,
      course: makeCourse("cs246"),
    });
    expect(res).toEqual({ status: "unresolved" });
    expect(savePlanMock).not.toHaveBeenCalled();
  });

  it("is unresolved when there is no local plan", async () => {
    loadPlanMock.mockReturnValue(null);
    const res = await commitAddCourse({
      isAuthed: false,
      planId: null,
      term: FALL,
      course: makeCourse("cs246"),
    });
    expect(res).toEqual({ status: "unresolved" });
  });

  it("surfaces a storage write failure as an error", async () => {
    loadPlanMock.mockReturnValue(
      localPlan([slot({ id: "a", position: "1A", termId: FALL })]),
    );
    savePlanMock.mockReturnValue(false);
    const res = await commitAddCourse({
      isAuthed: false,
      planId: null,
      term: FALL,
      course: makeCourse("cs246"),
    });
    expect(res).toEqual({ status: "error", error: "save_failed" });
  });

  it("prefers the academic slot over a co-op slot sharing the term", async () => {
    loadPlanMock.mockReturnValue(
      localPlan([
        slot({ id: "coop", position: "coop1", termId: WINTER, isCoop: true }),
        slot({ id: "acad", position: "1B", termId: WINTER }),
      ]),
    );
    await commitAddCourse({
      isAuthed: false,
      planId: null,
      term: WINTER,
      course: makeCourse("cs246"),
    });
    const saved = savePlanMock.mock.calls[0][0] as LocalPlan;
    expect(
      saved.slots.find((s) => s.id === "acad")?.courses.map((c) => c.code),
    ).toEqual(["cs246"]);
    expect(saved.slots.find((s) => s.id === "coop")?.courses).toEqual([]);
  });

  it("refuses a course closed to the plan's program (never saves)", async () => {
    loadPlanMock.mockReturnValue({
      ...localPlan([slot({ id: "a", position: "1A", termId: FALL })]),
      // SYDE plan; "Anthropology students only" is a hard program wall for it —
      // the one-click add must apply the same gate the slot picker enforces.
      programIds: ["systems-design-engineering"],
    });
    const res = await commitAddCourse({
      isAuthed: false,
      planId: null,
      term: FALL,
      course: makeCourse("anth101", { prereqs: "Anthropology students only" }),
    });
    expect(res).toEqual({ status: "blocked" });
    expect(savePlanMock).not.toHaveBeenCalled();
  });

  it("is unresolved (falls back to the picker) when a blocked read can't be verified", async () => {
    loadPlanMock.mockReturnValue({
      ...localPlan([slot({ id: "a", position: "1A", termId: FALL })]),
      // SE reads blocked too, but its detail isn't primed and can't be fetched
      // here — the verdict is unknown, and must not present as an academic rule.
      programIds: ["software-engineering"],
    });
    const res = await commitAddCourse({
      isAuthed: false,
      planId: null,
      term: FALL,
      course: makeCourse("anth101", { prereqs: "Anthropology students only" }),
    });
    expect(res).toEqual({ status: "unresolved" });
    expect(savePlanMock).not.toHaveBeenCalled();
  });

  it("reports already-placed over blocked when the blocked course is already in the plan", async () => {
    loadPlanMock.mockReturnValue({
      ...localPlan([
        slot({
          id: "a",
          position: "1A",
          termId: FALL,
          courses: [{ code: "anth101" }],
        }),
      ]),
      programIds: ["systems-design-engineering"],
    });
    const res = await commitAddCourse({
      isAuthed: false,
      planId: null,
      term: FALL,
      course: makeCourse("anth101", { prereqs: "Anthropology students only" }),
    });
    expect(res).toEqual({ status: "already-placed", label: "Fall 2025" });
    expect(savePlanMock).not.toHaveBeenCalled();
  });
});

describe("commitAddCourse — signed-in (server)", () => {
  it("loads, adds, and saves the full snapshot", async () => {
    loadServerPlanMock.mockResolvedValue({
      ok: true,
      data: serverPlan([
        slot({ id: "a", position: "1A", termId: FALL }),
        slot({ id: "b", position: "1B", termId: WINTER }),
      ]),
    });
    savePlanStateMock.mockResolvedValue({ ok: true, data: undefined });
    const res = await commitAddCourse({
      isAuthed: true,
      planId: "plan-1",
      term: FALL,
      course: makeCourse("cs246"),
    });
    expect(res).toEqual({ status: "added", termLabel: "Fall 2025" });
    expect(loadServerPlanMock).toHaveBeenCalledWith("plan-1");
    const [savedPlanId, snapshot] = savePlanStateMock.mock.calls[0];
    expect(savedPlanId).toBe("plan-1");
    expect(
      snapshot.slots.find((s) => s.id === "a")?.courses.map((c) => c.code),
    ).toEqual(["cs246"]);
  });

  it("is unresolved when authed with no planId (never loads)", async () => {
    const res = await commitAddCourse({
      isAuthed: true,
      planId: null,
      term: FALL,
      course: makeCourse("cs246"),
    });
    expect(res).toEqual({ status: "unresolved" });
    expect(loadServerPlanMock).not.toHaveBeenCalled();
  });

  it("surfaces a load error", async () => {
    loadServerPlanMock.mockResolvedValue({
      ok: false,
      error: "not_authenticated",
    });
    const res = await commitAddCourse({
      isAuthed: true,
      planId: "plan-1",
      term: FALL,
      course: makeCourse("cs246"),
    });
    expect(res).toEqual({ status: "error", error: "not_authenticated" });
  });

  it("maps a missing plan to a not_found error", async () => {
    loadServerPlanMock.mockResolvedValue({ ok: true, data: null });
    const res = await commitAddCourse({
      isAuthed: true,
      planId: "plan-1",
      term: FALL,
      course: makeCourse("cs246"),
    });
    expect(res).toEqual({ status: "error", error: "not_found" });
  });

  it("surfaces a save error", async () => {
    loadServerPlanMock.mockResolvedValue({
      ok: true,
      data: serverPlan([slot({ id: "a", position: "1A", termId: FALL })]),
    });
    savePlanStateMock.mockResolvedValue({
      ok: false,
      error: "snapshot_too_large",
    });
    const res = await commitAddCourse({
      isAuthed: true,
      planId: "plan-1",
      term: FALL,
      course: makeCourse("cs246"),
    });
    expect(res).toEqual({ status: "error", error: "snapshot_too_large" });
  });
});

// The pickers hand the core a chosen PlanSlot instead of a term; the gate
// sequence must behave identically for that shape.
describe("applyAddToPlan — direct slot target (picker path)", () => {
  it("adds into exactly the given slot, bypassing term resolution", async () => {
    const coop = slot({
      id: "coop",
      position: "coop1",
      termId: WINTER,
      isCoop: true,
    });
    const plan = localPlan([
      coop,
      slot({ id: "acad", position: "1B", termId: WINTER }),
    ]);
    // A term target would prefer the academic slot; the slot target must not.
    const res: ApplyAddResult<LocalPlan> = await applyAddToPlan(
      plan,
      coop,
      makeCourse("CS246"),
    );
    expect(res.status).toBe("added");
    if (res.status !== "added") return;
    expect(res.plan).not.toBe(plan);
    expect(
      res.plan.slots.find((s) => s.id === "coop")?.courses.map((c) => c.code),
    ).toEqual(["cs246"]);
    expect(res.plan.slots.find((s) => s.id === "acad")?.courses).toEqual([]);
  });

  it("refuses a course closed to the plan's program", async () => {
    const target = slot({ id: "a", position: "1A", termId: FALL });
    const res = await applyAddToPlan(
      { ...localPlan([target]), programIds: ["systems-design-engineering"] },
      target,
      makeCourse("anth101", { prereqs: "Anthropology students only" }),
    );
    expect(res).toEqual({ status: "blocked" });
  });

  it("reports already-placed over blocked", async () => {
    const target = slot({ id: "b", position: "1B", termId: WINTER });
    const res = await applyAddToPlan(
      {
        ...localPlan([
          slot({
            id: "a",
            position: "1A",
            termId: FALL,
            courses: [{ code: "anth101" }],
          }),
          target,
        ]),
        programIds: ["systems-design-engineering"],
      },
      target,
      makeCourse("anth101", { prereqs: "Anthropology students only" }),
    );
    expect(res).toEqual({ status: "already-placed", label: "Fall 2025" });
  });

  it("is unresolved when a blocked read can't be verified", async () => {
    const target = slot({ id: "a", position: "1A", termId: FALL });
    const res = await applyAddToPlan(
      { ...localPlan([target]), programIds: ["software-engineering"] },
      target,
      makeCourse("anth101", { prereqs: "Anthropology students only" }),
    );
    expect(res).toEqual({ status: "unresolved" });
  });
});

describe("runAddToPlanState — save wrapper", () => {
  function spies() {
    return {
      setSaving: vi.fn(),
      onSaved: vi.fn(),
      onAdded: vi.fn(),
      onError: vi.fn(),
    };
  }

  it("does not persist or report success when the add is refused (already placed)", async () => {
    const plan = localPlan([
      slot({
        id: "a",
        position: "1A",
        termId: FALL,
        courses: [{ code: "cs246" }],
      }),
      slot({ id: "b", position: "1B", termId: WINTER }),
    ]);
    const persist = vi.fn();
    const s = spies();

    await runAddToPlanState({
      plan,
      slot: plan.slots[1],
      course: makeCourse("cs246"),
      label: "1B",
      persist,
      ...s,
    });

    expect(persist).not.toHaveBeenCalled();
    expect(s.onSaved).not.toHaveBeenCalled();
    expect(s.onAdded).not.toHaveBeenCalled();
    expect(s.onError).not.toHaveBeenCalled();
    expect(s.setSaving.mock.calls).toEqual([[true], [false]]);
  });

  it("persists, reflects the new plan, and reports on a successful add", async () => {
    const plan = localPlan([slot({ id: "a", position: "1A", termId: FALL })]);
    const persist = vi.fn().mockResolvedValue({ ok: true });
    const s = spies();

    await runAddToPlanState({
      plan,
      slot: plan.slots[0],
      course: makeCourse("cs246"),
      label: "1A",
      persist,
      ...s,
    });

    expect(persist).toHaveBeenCalledOnce();
    expect(s.onAdded).toHaveBeenCalledExactlyOnceWith("1A");
    // onSaved receives the applied plan carrying the new course.
    const savedPlan = s.onSaved.mock.calls[0][0] as LocalPlan;
    expect(savedPlan.slots[0].courses.map((c) => c.code)).toContain("cs246");
    expect(s.setSaving.mock.calls).toEqual([[true], [false]]);
  });

  it("reports the persist error and leaves saved state untouched on ok:false", async () => {
    const plan = localPlan([slot({ id: "a", position: "1A", termId: FALL })]);
    const persist = vi
      .fn()
      .mockResolvedValue({ ok: false, error: "snapshot_too_large" });
    const s = spies();

    await runAddToPlanState({
      plan,
      slot: plan.slots[0],
      course: makeCourse("cs246"),
      label: "1A",
      persist,
      ...s,
    });

    expect(persist).toHaveBeenCalledOnce();
    expect(s.onError).toHaveBeenCalledExactlyOnceWith("snapshot_too_large");
    expect(s.onSaved).not.toHaveBeenCalled();
    expect(s.onAdded).not.toHaveBeenCalled();
    expect(s.setSaving.mock.calls).toEqual([[true], [false]]);
  });

  it("treats a thrown persist as a failed save: onError, no saved state, saving cleared, no rejection", async () => {
    const plan = localPlan([slot({ id: "a", position: "1A", termId: FALL })]);
    const persist = vi.fn().mockRejectedValue(new Error("Network down"));
    const s = spies();

    await expect(
      runAddToPlanState({
        plan,
        slot: plan.slots[0],
        course: makeCourse("cs246"),
        label: "1A",
        persist,
        ...s,
      }),
    ).resolves.toBeUndefined();

    expect(s.onError).toHaveBeenCalledExactlyOnceWith("Network down");
    expect(s.onSaved).not.toHaveBeenCalled();
    expect(s.onAdded).not.toHaveBeenCalled();
    expect(s.setSaving.mock.calls).toEqual([[true], [false]]);
  });
});
