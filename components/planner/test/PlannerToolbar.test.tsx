// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlannerToolbar } from "../PlannerToolbar";

afterEach(cleanup);

const baseProps = {
  planName: "Untitled plan",
  summary: "SYDE · Stream 8 co-op · Fall 2025 · 16 slots",
  saveStatus: null,
  onRetrySave: () => {},
  onOpenSettings: () => {},
  onUploadTranscript: () => {},
};

describe("PlannerToolbar", () => {
  it("renders the plan name and summary", () => {
    render(<PlannerToolbar {...baseProps} />);
    expect(screen.getByText("Untitled plan")).toBeTruthy();
    expect(
      screen.getByText(/SYDE · Stream 8 co-op · Fall 2025 · 16 slots/),
    ).toBeTruthy();
  });

  it("hides the sync chip when saveStatus is null (anon mode)", () => {
    render(<PlannerToolbar {...baseProps} />);
    expect(screen.queryByText(/saving|saved|save failed/i)).toBeNull();
  });

  it("shows the sync chip when a saveStatus is provided", () => {
    render(<PlannerToolbar {...baseProps} saveStatus={{ kind: "saving" }} />);
    expect(screen.getByText(/saving/i)).toBeTruthy();
  });

  it("invokes onOpenSettings when the summary is clicked", () => {
    const onOpenSettings = vi.fn();
    render(<PlannerToolbar {...baseProps} onOpenSettings={onOpenSettings} />);
    fireEvent.click(
      screen.getByText(/SYDE · Stream 8 co-op · Fall 2025 · 16 slots/),
    );
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("invokes onUploadTranscript when Import transcript is clicked", () => {
    const onUploadTranscript = vi.fn();
    render(
      <PlannerToolbar {...baseProps} onUploadTranscript={onUploadTranscript} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /import transcript/i }));
    expect(onUploadTranscript).toHaveBeenCalledOnce();
  });

  it("renders the Reset plan button only when onReset is provided", () => {
    const { rerender } = render(<PlannerToolbar {...baseProps} />);
    expect(screen.queryByRole("button", { name: /reset plan/i })).toBeNull();

    const onReset = vi.fn();
    rerender(<PlannerToolbar {...baseProps} onReset={onReset} />);
    const btn = screen.getByRole("button", { name: /reset plan/i });
    fireEvent.click(btn);
    expect(onReset).toHaveBeenCalledOnce();
  });
});
