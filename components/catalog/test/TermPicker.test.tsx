// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Course } from "@/lib/courses/types";
import type { LocalPlan, PlanSlot, SlotCourse } from "@/lib/plan/types";
import { PLAN_SCHEMA_VERSION } from "@/lib/plan/types";
import { makeTermId } from "@/lib/terms";

// Storage is the only side-effecting dependency: drive `loadPlan` to set the
// initial plan and spy on `savePlan` to observe what gets written. The prereq
// engine, term labels, and completed-set derivation run for real so the tests
// exercise the actual eligibility wiring.
const { loadPlanMock, savePlanMock } = vi.hoisted(() => ({
  loadPlanMock: vi.fn<() => LocalPlan | null>(),
  savePlanMock: vi.fn<(plan: LocalPlan) => boolean>(() => true),
}));
vi.mock("@/lib/plan/storage", () => ({
  loadPlan: loadPlanMock,
  savePlan: savePlanMock,
}));

// Make close synchronous/observable; TermPicker only reads these three.
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
  return {
    termId: null,
    isCoop: false,
    courses: [],
    ...over,
  };
}

function makePlan(slots: PlanSlot[]): LocalPlan {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    programId: "se",
    specializationId: null,
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  savePlanMock.mockReturnValue(true);
});

describe("TermPicker", () => {
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

  it("writes the course into exactly the chosen term and confirms", () => {
    loadPlanMock.mockReturnValue(
      makePlan([
        slot({ id: "a", position: "1A", termId: FALL_2025 }),
        slot({ id: "b", position: "1B", termId: WINTER_2025 }),
      ]),
    );
    render(<TermPicker course={makeCourse()} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Winter 2025/ }));

    expect(savePlanMock).toHaveBeenCalledOnce();
    const saved = savePlanMock.mock.calls[0][0];
    const placed = slotsWithCode(saved, "cs246");
    expect(placed.map((s) => s.id)).toEqual(["b"]);
    expect(screen.getByText(/Added to Winter 2025/)).toBeTruthy();
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

  it("does not write a duplicate when the course is already placed", () => {
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
    // writer-level guard also refuses (defense in depth).
    fireEvent.click(screen.getByRole("button", { name: /Winter 2025/ }));
    expect(savePlanMock).not.toHaveBeenCalled();
  });

  it("disables terms where the prerequisite isn't met", () => {
    loadPlanMock.mockReturnValue(
      makePlan([slot({ id: "a", position: "1A", termId: FALL_2025 })]),
    );
    render(
      <TermPicker
        course={makeCourse({ prereqs: "MATH116" })}
        onClose={vi.fn()}
      />,
    );

    // MATH116 sits nowhere in the plan, so the term is ineligible.
    expect(screen.getByRole("button", { name: /Fall 2025/ })).toHaveProperty(
      "disabled",
      true,
    );
  });
});
