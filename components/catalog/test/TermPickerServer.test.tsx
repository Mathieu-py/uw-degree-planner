// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Course } from "@/lib/courses/types";
import type {
  PlanSnapshot,
  PlanSummary,
  ServerPlan,
} from "@/lib/plan/server/types";
import type { PlanSlot } from "@/lib/plan/types";
import { makeTermId } from "@/lib/terms";

const {
  authStateMock,
  usePlanListMock,
  loadServerPlanMock,
  savePlanStateMock,
  plansContainingCourseMock,
} = vi.hoisted(() => ({
  authStateMock: vi.fn(),
  usePlanListMock: vi.fn(),
  loadServerPlanMock: vi.fn(),
  savePlanStateMock: vi.fn(),
  plansContainingCourseMock: vi.fn(),
}));

vi.mock("@/lib/auth/store", () => ({ useAuthState: authStateMock }));
vi.mock("@/lib/plan/sync/usePlanList", () => ({
  usePlanList: usePlanListMock,
}));
vi.mock("@/lib/plan/server/actions", () => ({
  loadServerPlan: loadServerPlanMock,
  savePlanState: savePlanStateMock,
  plansContainingCourse: plansContainingCourseMock,
}));
vi.mock("@/lib/hooks/useModalExit", () => ({
  useModalExit: () => ({
    isClosing: false,
    handleClose: vi.fn(),
    animateOut: () => Promise.resolve(),
  }),
}));

import { TermPicker } from "../TermPicker";

const FALL_2025 = makeTermId(2025, "Fall"); // → "Fall 2025"
const WINTER_2025 = makeTermId(2025, "Winter"); // → "Winter 2025"

const SIGNED_IN = {
  user: { id: "u1" },
  username: "tester",
  displayName: "tester",
  ready: true,
  isAuthed: true,
};

function makeCourse(over: Partial<Course> = {}): Course {
  return {
    id: 1,
    code: "CS246",
    name: "Object-Oriented Software Development",
    prereqs: null,
    coreqs: null,
    antireqs: null,
    rating: null,
    sections: [],
    prefix: "cs",
    level: 200,
    hasSeats: true,
    ...over,
  };
}

function slot(
  over: Partial<PlanSlot> & Pick<PlanSlot, "id" | "position">,
): PlanSlot {
  return { termId: null, isCoop: false, courses: [], ...over };
}

function makeServerPlan(
  slots: PlanSlot[],
  over: Partial<ServerPlan> = {},
): ServerPlan {
  return {
    id: "plan-1",
    name: "My plan",
    programId: "se",
    specializationId: null,
    stream: "regular",
    startTermId: FALL_2025,
    programScrapeVersion: null,
    slots,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function mkSummary(over: Partial<PlanSummary> = {}): PlanSummary {
  return {
    id: "plan-1",
    name: "My plan",
    programId: "se",
    specializationId: null,
    stream: "regular",
    startTermId: FALL_2025,
    shareToken: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function mockPlanList(
  plans: PlanSummary[] | null,
  over: Record<string, unknown> = {},
) {
  usePlanListMock.mockReturnValue({
    plans,
    loading: false,
    error: null,
    refetch: vi.fn(),
    create: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
    duplicate: vi.fn(),
    share: vi.fn(),
    ...over,
  });
}

beforeEach(() => {
  authStateMock.mockReturnValue(SIGNED_IN);
  savePlanStateMock.mockResolvedValue({ ok: true, data: undefined });
  // Default: the course is in none of the user's plans.
  plansContainingCourseMock.mockResolvedValue({ ok: true, data: [] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TermPicker — signed in", () => {
  it("shows a create-a-plan empty state when the user has no plans", () => {
    mockPlanList([]);
    render(<TermPicker course={makeCourse()} onClose={vi.fn()} />);

    expect(screen.getByText(/don't have any plans yet/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /create a plan/i })).toBeTruthy();
    expect(loadServerPlanMock).not.toHaveBeenCalled();
  });

  it("auto-advances to term selection when there is exactly one plan", async () => {
    mockPlanList([mkSummary()]);
    loadServerPlanMock.mockResolvedValue({
      ok: true,
      data: makeServerPlan([
        slot({ id: "a", position: "1A", termId: FALL_2025 }),
        slot({ id: "b", position: "1B", termId: WINTER_2025 }),
      ]),
    });
    render(<TermPicker course={makeCourse()} onClose={vi.fn()} />);

    expect(
      await screen.findByRole("button", { name: /Fall 2025/ }),
    ).toBeTruthy();
    expect(loadServerPlanMock).toHaveBeenCalledWith("plan-1");
    // No plan-picker step was shown, so there's no "back to plans" affordance.
    expect(screen.queryByRole("button", { name: /Plans/ })).toBeNull();
  });

  it("lists plans, then loads the chosen one for term selection", async () => {
    mockPlanList([
      mkSummary({ id: "p1", name: "Regular plan" }),
      mkSummary({ id: "p2", name: "Co-op plan" }),
    ]);
    loadServerPlanMock.mockResolvedValue({
      ok: true,
      data: makeServerPlan(
        [slot({ id: "a", position: "1A", termId: FALL_2025 })],
        { id: "p2" },
      ),
    });
    render(<TermPicker course={makeCourse()} onClose={vi.fn()} />);

    expect(screen.getByText("Add to which plan?")).toBeTruthy();
    // The list renders once the membership lookup resolves.
    fireEvent.click(await screen.findByRole("button", { name: /Co-op plan/ }));

    expect(
      await screen.findByRole("button", { name: /Fall 2025/ }),
    ).toBeTruthy();
    expect(loadServerPlanMock).toHaveBeenCalledWith("p2");
  });

  it("greys out plans that already contain the course", async () => {
    mockPlanList([
      mkSummary({ id: "p1", name: "Has it" }),
      mkSummary({ id: "p2", name: "Doesn't have it" }),
    ]);
    plansContainingCourseMock.mockResolvedValue({ ok: true, data: ["p1"] });
    loadServerPlanMock.mockResolvedValue({
      ok: true,
      data: makeServerPlan(
        [slot({ id: "a", position: "1A", termId: FALL_2025 })],
        { id: "p2" },
      ),
    });
    render(<TermPicker course={makeCourse()} onClose={vi.fn()} />);

    const hasIt = await screen.findByRole("button", { name: /Has it/ });
    expect(hasIt).toHaveProperty("disabled", true);
    expect(screen.getByText(/Already in this plan/)).toBeTruthy();

    // The other plan is selectable and proceeds to term selection.
    const other = screen.getByRole("button", { name: /Doesn't have it/ });
    expect(other).toHaveProperty("disabled", false);
    fireEvent.click(other);
    expect(
      await screen.findByRole("button", { name: /Fall 2025/ }),
    ).toBeTruthy();
    expect(loadServerPlanMock).toHaveBeenCalledWith("p2");
  });

  it("persists the add as a full snapshot that preserves existing courses", async () => {
    mockPlanList([mkSummary()]);
    loadServerPlanMock.mockResolvedValue({
      ok: true,
      data: makeServerPlan([
        slot({
          id: "a",
          position: "1A",
          termId: FALL_2025,
          courses: [{ code: "math135" }],
        }),
        slot({ id: "b", position: "1B", termId: WINTER_2025 }),
      ]),
    });
    const onClose = vi.fn();
    render(<TermPicker course={makeCourse()} onClose={onClose} />);

    fireEvent.click(await screen.findByRole("button", { name: /Winter 2025/ }));

    await waitFor(() => expect(savePlanStateMock).toHaveBeenCalledOnce());
    const [planId, snapshot] = savePlanStateMock.mock.calls[0] as [
      string,
      PlanSnapshot,
    ];
    expect(planId).toBe("plan-1");
    const slotA = snapshot.slots.find((s) => s.id === "a");
    const slotB = snapshot.slots.find((s) => s.id === "b");
    expect(slotA?.courses.map((c) => c.code)).toEqual(["math135"]);
    expect(slotB?.courses.map((c) => c.code)).toEqual(["cs246"]);
    // A successful save dismisses the picker.
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("flags an already-placed course and never saves a duplicate", async () => {
    mockPlanList([mkSummary()]);
    loadServerPlanMock.mockResolvedValue({
      ok: true,
      data: makeServerPlan([
        slot({
          id: "a",
          position: "1A",
          termId: FALL_2025,
          courses: [{ code: "cs246" }],
        }),
        slot({ id: "b", position: "1B", termId: WINTER_2025 }),
      ]),
    });
    render(<TermPicker course={makeCourse()} onClose={vi.fn()} />);

    expect(await screen.findByText(/Already placed in Fall 2025/)).toBeTruthy();
    const winter = screen.getByRole("button", { name: /Winter 2025/ });
    expect(winter).toHaveProperty("disabled", true);
    // Fire anyway to prove the writer-level guard refuses.
    fireEvent.click(winter);
    expect(savePlanStateMock).not.toHaveBeenCalled();
  });

  it("surfaces a load failure with a retry", async () => {
    mockPlanList([mkSummary()]);
    loadServerPlanMock.mockResolvedValue({
      ok: false,
      error: "not_authenticated",
    });
    render(<TermPicker course={makeCourse()} onClose={vi.fn()} />);

    expect(await screen.findByText(/session expired/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
  });

  it("treats a missing plan as no longer available", async () => {
    mockPlanList([mkSummary()]);
    loadServerPlanMock.mockResolvedValue({ ok: true, data: null });
    render(<TermPicker course={makeCourse()} onClose={vi.fn()} />);

    expect(await screen.findByText(/no longer available/i)).toBeTruthy();
  });

  it("keeps the modal open and shows an error when the save fails", async () => {
    mockPlanList([mkSummary()]);
    loadServerPlanMock.mockResolvedValue({
      ok: true,
      data: makeServerPlan([
        slot({ id: "b", position: "1B", termId: WINTER_2025 }),
      ]),
    });
    savePlanStateMock.mockResolvedValue({
      ok: false,
      error: "snapshot_too_large",
    });
    const onClose = vi.fn();
    render(<TermPicker course={makeCourse()} onClose={onClose} />);

    fireEvent.click(await screen.findByRole("button", { name: /Winter 2025/ }));

    expect(await screen.findByText(/too large to save/i)).toBeTruthy();
    // Still on the term step, not dismissed.
    expect(screen.getByRole("button", { name: /Winter 2025/ })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
