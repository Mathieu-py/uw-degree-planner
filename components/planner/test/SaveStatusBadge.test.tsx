// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SaveStatusBadge } from "../SaveStatusBadge";

describe("SaveStatusBadge", () => {
  it("renders nothing when idle", () => {
    const { container } = render(
      <SaveStatusBadge status={{ kind: "idle" }} onRetry={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the saving label", () => {
    render(<SaveStatusBadge status={{ kind: "saving" }} onRetry={() => {}} />);
    expect(screen.getByText(/saving/i)).toBeTruthy();
  });

  it("renders the saved label", () => {
    render(
      <SaveStatusBadge
        status={{ kind: "saved", at: Date.now() }}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText(/saved/i)).toBeTruthy();
  });

  it("renders error as a button that triggers retry on click", () => {
    const onRetry = vi.fn();
    render(
      <SaveStatusBadge
        status={{ kind: "error", message: "rls denied" }}
        onRetry={onRetry}
      />,
    );
    const btn = screen.getByRole("button", { name: /save failed/i });
    expect(btn.getAttribute("title")).toBe("rls denied");
    fireEvent.click(btn);
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
