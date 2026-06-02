// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COURSE_DRAG_MIME, type CourseDragData } from "@/lib/plan/dnd";
import { fakeDataTransfer } from "@/lib/plan/test/fakeDataTransfer";
import type { PlanSlot } from "@/lib/plan/types";
import { SlotBody } from "../SlotBody";
import { TermColumn } from "../TermColumn";

const ACADEMIC_SLOT: PlanSlot = {
  id: "slot-1a",
  termId: 1239,
  position: "1A",
  isCoop: false,
  courses: [{ code: "math115" }],
};

afterEach(cleanup);

describe("TermColumn drop target", () => {
  it("calls onCourseDrop with the slot id and parsed payload on drop", () => {
    const onCourseDrop = vi.fn();
    render(
      <TermColumn
        slot={ACADEMIC_SLOT}
        issues={[]}
        onSlotClick={() => {}}
        onRemoveCourse={() => {}}
        onCourseDrop={onCourseDrop}
      />,
    );

    const payload: CourseDragData = {
      kind: "move",
      fromSlotId: "slot-other",
      code: "cs136",
    };
    const card = screen.getByText("1A").closest(".pw-term");
    if (!card) throw new Error("term card not found");

    fireEvent.drop(card, {
      dataTransfer: fakeDataTransfer({
        type: COURSE_DRAG_MIME,
        value: JSON.stringify(payload),
      }),
    });

    expect(onCourseDrop).toHaveBeenCalledWith("slot-1a", payload);
  });

  it("toggles the is-drop highlight on dragOver/dragLeave of a course drag", () => {
    render(
      <TermColumn
        slot={ACADEMIC_SLOT}
        issues={[]}
        onSlotClick={() => {}}
        onRemoveCourse={() => {}}
        onCourseDrop={() => {}}
      />,
    );
    const card = screen.getByText("1A").closest(".pw-term");
    if (!card) throw new Error("term card not found");

    fireEvent.dragOver(card, {
      dataTransfer: fakeDataTransfer({ type: COURSE_DRAG_MIME, value: "{}" }),
    });
    expect(card.classList.contains("is-drop")).toBe(true);

    // dragLeave with no relatedTarget = a real exit → clears the highlight.
    fireEvent.dragLeave(card, { relatedTarget: null });
    expect(card.classList.contains("is-drop")).toBe(false);
  });

  it("is inert as a drop target without onCourseDrop (read-only views)", () => {
    const { container } = render(
      <TermColumn
        slot={ACADEMIC_SLOT}
        issues={[]}
        onSlotClick={() => {}}
        onRemoveCourse={() => {}}
        readOnly
      />,
    );
    const card = container.querySelector(".pw-term");
    if (!card) throw new Error("term card not found");

    fireEvent.dragOver(card, {
      dataTransfer: fakeDataTransfer({ type: COURSE_DRAG_MIME, value: "{}" }),
    });
    expect(card.classList.contains("is-drop")).toBe(false);
  });
});

describe("TermColumn eligibility highlight", () => {
  function renderWith(eligibility: "eligible" | "ineligible" | null) {
    const { container } = render(
      <TermColumn
        slot={ACADEMIC_SLOT}
        issues={[]}
        onSlotClick={() => {}}
        onRemoveCourse={() => {}}
        onCourseDrop={() => {}}
        eligibility={eligibility}
      />,
    );
    const card = container.querySelector(".pw-term");
    if (!card) throw new Error("term card not found");
    return card;
  }

  it("tints eligible terms and mutes ineligible ones", () => {
    expect(renderWith("eligible").classList.contains("pw-term-eligible")).toBe(
      true,
    );
    cleanup();
    expect(renderWith("ineligible").classList.contains("pw-term-muted")).toBe(
      true,
    );
  });

  it("applies no highlight class when not dragging (null)", () => {
    const card = renderWith(null);
    expect(card.classList.contains("pw-term-eligible")).toBe(false);
    expect(card.classList.contains("pw-term-muted")).toBe(false);
  });

  it("keeps is-drop alongside the eligible tint on dragOver", () => {
    const card = renderWith("eligible");
    fireEvent.dragOver(card, {
      dataTransfer: fakeDataTransfer({ type: COURSE_DRAG_MIME, value: "{}" }),
    });
    expect(card.classList.contains("pw-term-eligible")).toBe(true);
    expect(card.classList.contains("is-drop")).toBe(true);
  });
});

describe("SlotBody drag source", () => {
  it("writes a move payload identifying the course and its term on dragStart", () => {
    render(
      <SlotBody
        slot={ACADEMIC_SLOT}
        issuesByCourse={new Map()}
        onAdd={() => {}}
        onRemoveCourse={() => {}}
      />,
    );
    const chip = screen.getByText("MATH 115").closest(".pw-slot");
    if (!chip) throw new Error("course chip not found");

    const dt = fakeDataTransfer();
    fireEvent.dragStart(chip, { dataTransfer: dt });

    expect(dt.getData(COURSE_DRAG_MIME)).toBe(
      JSON.stringify({ kind: "move", fromSlotId: "slot-1a", code: "math115" }),
    );
  });

  it("dims the chip while it's in flight and restores it on dragEnd", () => {
    render(
      <SlotBody
        slot={ACADEMIC_SLOT}
        issuesByCourse={new Map()}
        onAdd={() => {}}
        onRemoveCourse={() => {}}
      />,
    );
    const chip = screen.getByText("MATH 115").closest(".pw-slot");
    if (!chip) throw new Error("course chip not found");

    fireEvent.dragStart(chip, { dataTransfer: fakeDataTransfer() });
    expect(chip.classList.contains("is-dragging")).toBe(true);

    fireEvent.dragEnd(chip);
    expect(chip.classList.contains("is-dragging")).toBe(false);
  });

  it("clears a stale drag dim when the course leaves and returns to the term", () => {
    const props = {
      issuesByCourse: new Map(),
      onAdd: () => {},
      onRemoveCourse: () => {},
    };
    const { rerender } = render(<SlotBody slot={ACADEMIC_SLOT} {...props} />);
    const chip = screen.getByText("MATH 115").closest(".pw-slot");
    if (!chip) throw new Error("course chip not found");

    // Drag out: the chip dims. The real drop relocates the course and unmounts
    // this chip, so its dragEnd never fires — hence no dragEnd call here.
    fireEvent.dragStart(chip, { dataTransfer: fakeDataTransfer() });
    expect(chip.classList.contains("is-dragging")).toBe(true);

    // Course leaves this term…
    rerender(<SlotBody slot={{ ...ACADEMIC_SLOT, courses: [] }} {...props} />);
    // …then is dropped back in. The returned chip must not be greyed out.
    rerender(
      <SlotBody
        slot={{ ...ACADEMIC_SLOT, courses: [{ code: "math115" }] }}
        {...props}
      />,
    );

    const returned = screen.getByText("MATH 115").closest(".pw-slot");
    expect(returned?.classList.contains("is-dragging")).toBe(false);
  });
});
