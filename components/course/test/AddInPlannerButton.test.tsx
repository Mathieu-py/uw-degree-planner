// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Course } from "@/lib/courses/types";
import { makeTermId } from "@/lib/terms";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

// Stub the two children so this test covers only the branch selection, not the
// heavy add/persist trees behind them.
vi.mock("../AddToTermButton", () => ({
  AddToTermButton: (props: { term: number; planId: string | null }) => (
    <div
      data-testid="add-to-term"
      data-term={props.term}
      data-plan={props.planId ?? ""}
    />
  ),
}));
vi.mock("@/components/catalog/TermPicker", () => ({
  TermPicker: () => <div data-testid="term-picker" />,
}));

import { AddInPlannerButton } from "../AddInPlannerButton";

const FALL = makeTermId(2025, "Fall");
const course = {
  code: "cs246",
  name: "Operating Systems",
} as unknown as Course;

afterEach(cleanup);

describe("AddInPlannerButton branch matrix", () => {
  it("renders nothing when arriving from a plan (already placed)", () => {
    const { container } = render(
      <AddInPlannerButton course={course} from="plan" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the one-click AddToTermButton from the picker (with a term)", () => {
    render(
      <AddInPlannerButton
        course={course}
        from="picker"
        planId="p1"
        term={FALL}
        backHref="/plan/p1"
      />,
    );
    const stub = screen.getByTestId("add-to-term");
    expect(stub.getAttribute("data-term")).toBe(String(FALL));
    expect(stub.getAttribute("data-plan")).toBe("p1");
    // Not the generic path.
    expect(screen.queryByRole("button", { name: /add to plan/i })).toBeNull();
  });

  it("falls back to the generic Add-to-plan button when the picker term is missing", () => {
    render(<AddInPlannerButton course={course} from="picker" planId="p1" />);
    expect(screen.queryByTestId("add-to-term")).toBeNull();
    expect(screen.getByRole("button", { name: /add to plan/i })).toBeTruthy();
  });

  it("opens the TermPicker from the catalog on click", () => {
    render(<AddInPlannerButton course={course} from="catalog" />);
    expect(screen.queryByTestId("term-picker")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /add to plan/i }));
    expect(screen.getByTestId("term-picker")).toBeTruthy();
  });

  it("shows the generic Add-to-plan button on a direct visit (no from)", () => {
    render(<AddInPlannerButton course={course} />);
    expect(screen.getByRole("button", { name: /add to plan/i })).toBeTruthy();
  });
});
