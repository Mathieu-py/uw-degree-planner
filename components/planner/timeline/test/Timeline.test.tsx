// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COURSE_DRAG_MIME, type CourseDragData } from "@/lib/plan/dnd";
import { fakeDataTransfer } from "@/lib/plan/test/fakeDataTransfer";
import type { LocalPlan } from "@/lib/plan/types";
import { Timeline } from "../Timeline";

const PLAN: LocalPlan = {
  schemaVersion: 3,
  programIds: ["software-engineering"],
  specializationIds: {},
  stream: "stream8",
  startTermId: 1239,
  slots: [
    { id: "1A", termId: 1239, position: "1A", isCoop: false, courses: [] },
    { id: "coop1", termId: 1245, position: "coop1", isCoop: true, courses: [] },
    { id: "2A", termId: 1251, position: "2A", isCoop: false, courses: [] },
  ],
  updatedAt: "2026-05-23T12:00:00.000Z",
};

const EMPTY_ISSUES = new Map();

afterEach(cleanup);

function dropOn(card: Element, data: CourseDragData) {
  fireEvent.drop(card, {
    dataTransfer: fakeDataTransfer({
      type: COURSE_DRAG_MIME,
      value: JSON.stringify(data),
    }),
  });
}

describe("Timeline drop forwarding", () => {
  it("forwards onCourseDrop to each academic term column (not co-op terms)", () => {
    const onCourseDrop = vi.fn();
    const { container } = render(
      <Timeline
        plan={PLAN}
        issuesPerSlot={EMPTY_ISSUES}
        onSlotClick={() => {}}
        onRemoveCourse={() => {}}
        onCourseDrop={onCourseDrop}
      />,
    );

    // Only the two academic terms render as `.pw-term` drop targets; the co-op
    // term is a separate inert card.
    const cards = container.querySelectorAll(".pw-term");
    expect(cards.length).toBe(2);

    const payload: CourseDragData = { kind: "add", code: "cs136" };
    for (const card of cards) dropOn(card, payload);

    expect(onCourseDrop).toHaveBeenCalledTimes(2);
    expect(onCourseDrop.mock.calls.map((c) => c[0])).toEqual(["1A", "2A"]);
    expect(onCourseDrop).toHaveBeenCalledWith("1A", payload);
    expect(onCourseDrop).toHaveBeenCalledWith("2A", payload);
  });
});

describe("Timeline eligibility highlight", () => {
  it("derives per-term eligible/muted from eligibleSlotIds; co-op never highlights", () => {
    const { container } = render(
      <Timeline
        plan={PLAN}
        issuesPerSlot={EMPTY_ISSUES}
        onSlotClick={() => {}}
        onRemoveCourse={() => {}}
        onCourseDrop={() => {}}
        eligibleSlotIds={new Set(["1A"])}
      />,
    );

    const cards = container.querySelectorAll(".pw-term");
    expect(cards.length).toBe(2); // 1A + 2A; co-op is a separate card
    const [first, second] = cards;
    expect(first.classList.contains("pw-term-eligible")).toBe(true);
    expect(second.classList.contains("pw-term-muted")).toBe(true);
    // The co-op card carries neither highlight class.
    expect(
      container
        .querySelector(".pw-coop")
        ?.classList.contains("pw-term-eligible"),
    ).toBe(false);
  });

  it("applies no highlight classes when eligibleSlotIds is absent", () => {
    const { container } = render(
      <Timeline
        plan={PLAN}
        issuesPerSlot={EMPTY_ISSUES}
        onSlotClick={() => {}}
        onRemoveCourse={() => {}}
        onCourseDrop={() => {}}
      />,
    );
    expect(container.querySelector(".pw-term-eligible")).toBeNull();
    expect(container.querySelector(".pw-term-muted")).toBeNull();
  });
});
