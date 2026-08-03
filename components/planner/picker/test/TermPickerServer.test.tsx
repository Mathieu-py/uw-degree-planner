// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PlanSnapshot,
  PlanSummary,
  ServerPlan,
} from "@/lib/plan/server/types";
import type { PlanSlot } from "@/lib/plan/types";
import { programDetail } from "@/lib/programs/detail";
import { makeTermId } from "@/lib/terms";
import { makeCourse, slot } from "./fixtures";

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

vi.mock("@/lib/auth/store", async () => ({
  useAuthState: authStateMock,
  AuthGate: (await import("./fixtures")).fakeAuthGate(authStateMock),
}));
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
  ready: true,
  isAuthed: true,
};

function makeServerPlan(
  slots: PlanSlot[],
  over: Partial<ServerPlan> = {},
): ServerPlan {
  return {
    id: "plan-1",
    name: "My plan",
    programIds: ["se"],
    specializationIds: {},
    acknowledgedRequirements: {},
    stream: "regular",
    startTermId: FALL_2025,
    slots,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function mkSummary(over: Partial<PlanSummary> = {}): PlanSummary {
  return {
    id: "plan-1",
    name: "My plan",
    programIds: ["se"],
    specializationIds: {},
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
    loadError: null,
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
  it("shows a loading state, not the plan list, until auth resolves", () => {
    authStateMock.mockReturnValue({ ...SIGNED_IN, ready: false });
    mockPlanList([mkSummary()]);
    render(<TermPicker course={makeCourse()} onClose={vi.fn()} />);

    expect(screen.getByText(/loading…/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /My plan/ })).toBeNull();
    expect(loadServerPlanMock).not.toHaveBeenCalled();
  });

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

  it("ignores a stale plan-load: A→list→B keeps B and saves the add to B", async () => {
    mockPlanList([
      mkSummary({ id: "plan-A", name: "Plan A" }),
      mkSummary({ id: "plan-B", name: "Plan B" }),
    ]);
    let resolveA!: (v: unknown) => void;
    loadServerPlanMock
      .mockImplementationOnce(() => new Promise((res) => (resolveA = res)))
      .mockResolvedValueOnce({
        ok: true,
        data: makeServerPlan(
          [slot({ id: "b1", position: "1B", termId: WINTER_2025 })],
          { id: "plan-B" },
        ),
      });
    render(<TermPicker course={makeCourse()} onClose={vi.fn()} />);

    // Select plan A — its load is held open.
    fireEvent.click(await screen.findByRole("button", { name: /Plan A/ }));
    expect(await screen.findByText("Loading plan…")).toBeTruthy();

    // Return to the list, then select plan B — B resolves.
    fireEvent.click(screen.getByRole("button", { name: /Plans/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Plan B/ }));
    expect(
      await screen.findByRole("button", { name: /Winter 2025/ }),
    ).toBeTruthy();

    // Plan A's load resolves last (Fall 2025) — it must be ignored.
    await act(async () => {
      resolveA({
        ok: true,
        data: makeServerPlan(
          [slot({ id: "a1", position: "1A", termId: FALL_2025 })],
          { id: "plan-A" },
        ),
      });
      await Promise.resolve();
    });

    // B is still displayed; the stale A load did not overwrite it.
    expect(screen.getByRole("button", { name: /Winter 2025/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Fall 2025/ })).toBeNull();

    // The save targets B, using B's snapshot.
    fireEvent.click(screen.getByRole("button", { name: /Winter 2025/ }));
    await waitFor(() => expect(savePlanStateMock).toHaveBeenCalled());
    const [planId, snapshot] = savePlanStateMock.mock.calls[0] as [
      string,
      PlanSnapshot,
    ];
    expect(planId).toBe("plan-B");
    const winter = snapshot.slots.find((s) => s.termId === WINTER_2025);
    expect(winter?.courses.map((c) => c.code)).toContain("cs246");
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

  it("disables only the plan whose program is barred (program check at the plan step)", async () => {
    // A math-faculty restriction blocks the CS plan but not the SYDE plan —
    // the check is per-plan at this step, not per-term.
    mockPlanList([
      mkSummary({
        id: "syde",
        name: "SYDE plan",
        programIds: ["systems-design-engineering"],
      }),
      mkSummary({
        id: "cs",
        name: "CS plan",
        programIds: ["h-computer-science-bcs"],
      }),
    ]);
    render(
      <TermPicker
        course={makeCourse({
          code: "cs114",
          prereqs: "Not open to Faculty of Math students.",
        })}
        onClose={vi.fn()}
      />,
    );

    const cs = await screen.findByRole("button", { name: /CS plan/ });
    expect(cs).toHaveProperty("disabled", true);
    expect(screen.getByText(/Not open to your program/i)).toBeTruthy();
    // The engineering plan can take it — still selectable.
    expect(screen.getByRole("button", { name: /SYDE plan/ })).toHaveProperty(
      "disabled",
      false,
    );
  });

  it("keeps a barred plan selectable when its loaded program references the course", async () => {
    // Both math-faculty programs are primed (JSDOM has no fetch; suppression
    // needs loaded detail); ids must not collide with the unloaded-program test.
    programDetail.prime({
      "data-science-bcs": {
        kind: "flexible",
        name: "DS Stub (Bachelor of Computer Science)",
        asOf: "2026-01-01",
        rules: { kind: "courses", courses: ["math239"] },
      },
      "computational-mathematics": {
        kind: "flexible",
        name: "CM Stub (Bachelor of Mathematics)",
        asOf: "2026-01-01",
        rules: { kind: "courses", courses: ["stat231"] },
      },
    });
    mockPlanList([
      mkSummary({
        id: "ds",
        name: "DS plan",
        programIds: ["data-science-bcs"],
      }),
      mkSummary({
        id: "cm",
        name: "CM plan",
        programIds: ["computational-mathematics"],
      }),
    ]);
    render(
      <TermPicker
        course={makeCourse({
          code: "math239",
          prereqs: "Not open to Faculty of Math students.",
        })}
        onClose={vi.fn()}
      />,
    );

    // computational-mathematics doesn't reference math239 → the wall holds.
    const cm = await screen.findByRole("button", { name: /CM plan/ });
    expect(cm).toHaveProperty("disabled", true);
    // data-science-bcs names math239 in its rules → wall suppressed.
    expect(screen.getByRole("button", { name: /DS plan/ })).toHaveProperty(
      "disabled",
      false,
    );
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

  it("flags an already-placed course and disables every term", async () => {
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
    // The writer-level guard (defense in depth) is covered directly in
    // lib/plan/test/commitAddCourse.test.ts.
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

  it("surfaces a plan-list load failure with a retry, not an endless spinner", async () => {
    const refetch = vi.fn();
    mockPlanList(null, { loadError: "not_authenticated", refetch });
    render(<TermPicker course={makeCourse()} onClose={vi.fn()} />);

    expect(await screen.findByText(/couldn't load your plans/i)).toBeTruthy();
    expect(screen.queryByText(/loading your plans/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(refetch).toHaveBeenCalledOnce();
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
