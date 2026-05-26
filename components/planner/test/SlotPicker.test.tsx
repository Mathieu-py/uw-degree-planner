// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Course } from "@/lib/types";
import { SlotPicker } from "../SlotPicker";

afterEach(cleanup);

function mkCourse(code: string, name: string): Course {
  const prefix = (code.match(/^[a-z]+/i)?.[0] ?? "").toUpperCase();
  const level = Math.floor(Number(code.replace(/[^\d]/g, "") || 0) / 100) * 100;
  return {
    id: code.length + name.length,
    code,
    name,
    description: null,
    prereqs: null,
    coreqs: null,
    antireqs: null,
    rating: { useful: 0.8, easy: 0.6, liked: 0.7, filled_count: 10 },
    sections: [],
    prefix,
    level,
    hasSeats: true,
  };
}

const CATALOG: Course[] = [
  mkCourse("cs115", "Intro to CS"),
  mkCourse("cs136", "Algorithm Design"),
  mkCourse("math115", "Linear Algebra"),
];

const NO_PLACED = new Set<string>();
const NO_COMPLETED = new Set<string>();

describe("SlotPicker", () => {
  it("invokes onPick with the clicked course code (after exit animation)", async () => {
    const onPick = vi.fn();
    render(
      <SlotPicker
        targetTermLabel="Fall 2023"
        catalog={CATALOG}
        placedCodes={NO_PLACED}
        completedBefore={NO_COMPLETED}
        onPick={onPick}
        onClose={vi.fn()}
      />,
    );
    // The picker renders course codes as clickable buttons inside the table.
    fireEvent.click(screen.getByRole("button", { name: /CS\s*115/i }));
    // onPick is deferred by the modal's exit animation (setTimeout EXIT_MS),
    // so we wait for the call to land rather than asserting synchronously.
    await waitFor(() => expect(onPick).toHaveBeenCalledWith("cs115"));
  });

  it("calls onClose when Escape is pressed (after exit animation)", async () => {
    const onClose = vi.fn();
    render(
      <SlotPicker
        targetTermLabel="Fall 2023"
        catalog={CATALOG}
        placedCodes={NO_PLACED}
        completedBefore={NO_COMPLETED}
        onPick={vi.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("filters to focusCodes when provided", () => {
    render(
      <SlotPicker
        targetTermLabel="Fall 2023"
        catalog={CATALOG}
        placedCodes={NO_PLACED}
        completedBefore={NO_COMPLETED}
        focusCodes={["math115"]}
        onPick={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // The header switches to the "filtered to requirement options" variant.
    expect(
      screen.queryByText(/filtered to requirement options/i),
    ).not.toBeNull();
    // Picker renders each row's code + name as two clickable buttons, so
    // there can be more than one match per course code — we just need at
    // least one MATH 115 row and zero CS rows.
    expect(
      screen.queryAllByRole("button", { name: /MATH\s*115/i }).length,
    ).toBeGreaterThan(0);
    expect(screen.queryAllByRole("button", { name: /CS\s*115/i })).toHaveLength(
      0,
    );
    expect(screen.queryAllByRole("button", { name: /CS\s*136/i })).toHaveLength(
      0,
    );
  });
});
