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
import type { LocalPlan, PlanSlot, SlotCourse } from "@/lib/plan/types";
import { PLAN_SCHEMA_VERSION } from "@/lib/plan/types";
import { makeTermId } from "@/lib/terms";
import { makeCourse, slot } from "./fixtures";

// Storage is the only side-effecting dependency: drive `loadPlan` to set the
// initial plan and spy on `savePlan` to observe what gets written. The prereq
// engine, term labels, and completed-set derivation run for real so the tests
// exercise the actual eligibility wiring.
const { loadPlanMock, savePlanMock, authStateMock } = vi.hoisted(() => ({
  loadPlanMock: vi.fn<() => LocalPlan | null>(),
  savePlanMock: vi.fn<(plan: LocalPlan) => boolean>(() => true),
  authStateMock: vi.fn(),
}));
vi.mock("@/lib/plan/storage", () => ({
  loadPlan: loadPlanMock,
  savePlan: savePlanMock,
}));

// These tests exercise the signed-out (local plan) branch. Pin auth to
// "ready, signed out" so the wrapper renders the local body. The signed-in
// branch is covered in TermPickerServer.test.tsx.
vi.mock("@/lib/auth/store", () => ({ useAuthState: authStateMock }));

// TermPicker statically imports the plan server actions (for the signed-in
// branch). The real module pulls in `server-only`, which throws under jsdom,
// so stub it out — the local branch never calls these.
vi.mock("@/lib/plan/server/actions", () => ({
  loadServerPlan: vi.fn(),
  savePlanState: vi.fn(),
  plansContainingCourse: vi.fn(),
}));

// Make close synchronous/observable; TermPicker only reads these three.
vi.mock("@/lib/hooks/useModalExit", () => ({
  useModalExit: () => ({
    isClosing: false,
    handleClose: vi.fn(),
    animateOut: () => Promise.resolve(),
  }),
}));

const SIGNED_OUT = {
  user: null,
  username: null,
  displayName: null,
  ready: true,
  isAuthed: false,
};

import { TermPicker } from "../TermPicker";

const FALL_2025 = makeTermId(2025, "Fall"); // → "Fall 2025"
const WINTER_2025 = makeTermId(2025, "Winter"); // → "Winter 2025"

function makePlan(slots: PlanSlot[]): LocalPlan {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    programIds: ["se"],
    specializationIds: {},
    stream: "regular",
    startTermId: FALL_2025,
    slots,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

// Where does a given course code live across the whole plan?
function slotsWithCode(plan: LocalPlan, code: string): PlanSlot[] {
  return plan.slots.filter((s) => s.courses.some((c) => c.code === code));
}

beforeEach(() => {
  authStateMock.mockReturnValue(SIGNED_OUT);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  savePlanMock.mockReturnValue(true);
});

describe("TermPicker", () => {
  it("shows a loading state until auth resolves", () => {
    authStateMock.mockReturnValue({ ...SIGNED_OUT, ready: false });
    loadPlanMock.mockReturnValue(null);
    render(<TermPicker course={makeCourse()} onClose={vi.fn()} />);

    expect(screen.getByText(/loading…/i)).toBeTruthy();
    // No local body, even though loadPlan would return null — the wrapper must
    // not read storage or flash the signed-out empty state before `ready`.
    expect(screen.queryByText(/don't have a local plan yet/i)).toBeNull();
    expect(loadPlanMock).not.toHaveBeenCalled();
  });

  it("prompts to start a plan when none exists", () => {
    loadPlanMock.mockReturnValue(null);
    render(<TermPicker course={makeCourse()} onClose={vi.fn()} />);

    expect(screen.getByText(/don't have a local plan yet/i)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /open the planner/i }),
    ).toBeTruthy();
  });

  it("offers one option per academic term, excluding pre and co-op slots", () => {
    loadPlanMock.mockReturnValue(
      makePlan([
        slot({ id: "p", position: "pre" }),
        slot({ id: "a", position: "1A", termId: FALL_2025 }),
        slot({ id: "w", position: "coop1", termId: WINTER_2025, isCoop: true }),
        slot({ id: "b", position: "1B", termId: WINTER_2025 }),
      ]),
    );
    render(<TermPicker course={makeCourse()} onClose={vi.fn()} />);

    expect(screen.getByRole("button", { name: /Fall 2025/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Winter 2025/ })).toBeTruthy();
    // pre + co-op slots produce no option buttons.
    expect(screen.queryByRole("button", { name: /coop1/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^pre/ })).toBeNull();
  });

  it("writes the course into the chosen term and dismisses the picker", async () => {
    const onClose = vi.fn();
    loadPlanMock.mockReturnValue(
      makePlan([
        slot({ id: "a", position: "1A", termId: FALL_2025 }),
        slot({ id: "b", position: "1B", termId: WINTER_2025 }),
      ]),
    );
    render(<TermPicker course={makeCourse()} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /Winter 2025/ }));

    // The write lands after the async gate sequence in applyAddToPlan.
    await waitFor(() => expect(savePlanMock).toHaveBeenCalledOnce());
    const saved = savePlanMock.mock.calls[0][0];
    const placed = slotsWithCode(saved, "cs246");
    expect(placed.map((s) => s.id)).toEqual(["b"]);
    // Picking a term closes the picker — nothing more to do on that course.
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("flags an already-placed course and disables every term option", () => {
    const placed: SlotCourse = { code: "cs246" };
    loadPlanMock.mockReturnValue(
      makePlan([
        slot({ id: "a", position: "1A", termId: FALL_2025, courses: [placed] }),
        slot({ id: "b", position: "1B", termId: WINTER_2025 }),
      ]),
    );
    render(<TermPicker course={makeCourse()} onClose={vi.fn()} />);

    expect(screen.getByText(/Already placed in Fall 2025/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Fall 2025/ })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: /Winter 2025/ })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("does not write a duplicate when the course is already placed", async () => {
    loadPlanMock.mockReturnValue(
      makePlan([
        slot({
          id: "a",
          position: "1A",
          termId: FALL_2025,
          courses: [{ code: "cs246" }],
        }),
        slot({ id: "b", position: "1B", termId: WINTER_2025 }),
      ]),
    );
    render(<TermPicker course={makeCourse()} onClose={vi.fn()} />);

    // The buttons are disabled, but fire the handler directly to prove the
    // writer-level guard also refuses (defense in depth). The act wrap flushes
    // the async gate sequence so the negative assertion isn't vacuous.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Winter 2025/ }));
    });
    expect(savePlanMock).not.toHaveBeenCalled();
  });

  it("shows a program-block notice instead of terms when the course is closed to the plan's program", () => {
    loadPlanMock.mockReturnValue({
      ...makePlan([slot({ id: "a", position: "1A", termId: FALL_2025 })]),
      // A SYDE plan; "Anthropology students only" is a hard program wall for it.
      programIds: ["systems-design-engineering"],
    });
    render(
      <TermPicker
        course={makeCourse({
          code: "anth101",
          prereqs: "Anthropology students only",
        })}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/isn't open to your program/i)).toBeTruthy();
    // A plan-level block replaces the term list entirely — no term buttons.
    expect(screen.queryByRole("button", { name: /Fall 2025/ })).toBeNull();
  });

  it("prefers the already-placed notice over the program block when both apply", () => {
    loadPlanMock.mockReturnValue({
      ...makePlan([
        slot({
          id: "a",
          position: "1A",
          termId: FALL_2025,
          courses: [{ code: "anth101" }],
        }),
      ]),
      // Placed (e.g. via transcript import) before the plan became SYDE, so it's
      // both in the plan AND closed to the program. Already-placed wins.
      programIds: ["systems-design-engineering"],
    });
    render(
      <TermPicker
        course={makeCourse({
          code: "anth101",
          prereqs: "Anthropology students only",
        })}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/already placed in fall 2025/i)).toBeTruthy();
    expect(screen.queryByText(/isn't open to your program/i)).toBeNull();
  });

  it("keeps a term with unmet prerequisites addable (soft warning, not disabled)", () => {
    loadPlanMock.mockReturnValue(
      makePlan([slot({ id: "a", position: "1A", termId: FALL_2025 })]),
    );
    render(
      <TermPicker
        course={makeCourse({ prereqs: "MATH116" })}
        onClose={vi.fn()}
      />,
    );

    // MATH116 sits nowhere in the plan, but a missing prereq is only a warning —
    // the student can still plan the course ahead of it, so the term stays
    // clickable (matches the slot picker). Only a program block disables.
    expect(screen.getByRole("button", { name: /Fall 2025/ })).toHaveProperty(
      "disabled",
      false,
    );
  });
});
