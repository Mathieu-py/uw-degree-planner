// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlanSlot } from "@/lib/plan/types";
import { TermOptionList } from "../TermOptionList";
import type { TermOption } from "../termOptions";

afterEach(cleanup);

const SLOT: PlanSlot = {
  id: "s1",
  termId: 1259,
  position: "1A",
  isCoop: false,
  courses: [],
};

function option(over: Partial<TermOption>): TermOption {
  return {
    slot: SLOT,
    label: "Fall 2025",
    state: "missing",
    hint: "",
    ...over,
  };
}

describe("TermOptionList gating", () => {
  it("keeps a prereq/antireq-ineligible term addable (not disabled)", () => {
    // A program block never reaches here (it's plan-level); prereq/antireq gaps
    // are only warnings, so the term stays clickable.
    render(
      <TermOptionList
        options={[option({ state: "missing" })]}
        alreadyIn={null}
        onPick={vi.fn()}
      />,
    );
    expect(screen.getByRole("button")).toHaveProperty("disabled", false);
    expect(screen.getByText("Missing")).toBeTruthy();
  });

  it("disables every term once the course is already placed", () => {
    render(
      <TermOptionList
        options={[option({ state: "eligible" })]}
        alreadyIn="Fall 2025"
        onPick={vi.fn()}
      />,
    );
    expect(screen.getByRole("button")).toHaveProperty("disabled", true);
  });

  it("disables during an in-flight save (busy)", () => {
    render(
      <TermOptionList
        options={[option({ state: "eligible" })]}
        alreadyIn={null}
        busy
        onPick={vi.fn()}
      />,
    );
    expect(screen.getByRole("button")).toHaveProperty("disabled", true);
  });
});
