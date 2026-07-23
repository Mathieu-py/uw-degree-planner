// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Alert } from "../Alert";

afterEach(cleanup);

describe("Alert", () => {
  it("renders children in a danger sm box with role=alert by default", () => {
    render(<Alert>Something broke</Alert>);
    const box = screen.getByRole("alert");
    expect(box.textContent).toBe("Something broke");
    expect(box.className).toContain("rounded-[8px]");
    expect(box.className).toContain("text-xs");
    expect(box.className).toContain("border-danger");
    expect(box.className).toContain("bg-danger-soft");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders the title as a bold headline with children as detail lines", () => {
    render(
      <Alert title="We couldn't load your plans.">
        <p>Session expired</p>
      </Alert>,
    );
    const headline = screen.getByText("We couldn't load your plans.");
    expect(headline.className).toContain("font-medium");
    expect(screen.getByText("Session expired").parentElement?.className).toContain(
      "opacity-80",
    );
  });

  it("renders a Try again button that fires onRetry", () => {
    const onRetry = vi.fn();
    render(<Alert onRetry={onRetry}>Load failed</Alert>);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("applies size classes", () => {
    render(<Alert size="md">md box</Alert>);
    expect(screen.getByRole("alert").className).toContain("rounded-[10px]");
    expect(screen.getByRole("alert").className).toContain("py-3");
    cleanup();
    render(<Alert size="lg">lg box</Alert>);
    expect(screen.getByRole("alert").className).toContain("rounded-[10px]");
    expect(screen.getByRole("alert").className).toContain("py-6");
  });

  it("applies the partial variant", () => {
    render(<Alert variant="partial">Plan missing</Alert>);
    const box = screen.getByRole("alert");
    expect(box.className).toContain("border-partial");
    expect(box.className).toContain("text-ink");
  });

  it("passes through className and aria attributes", () => {
    render(
      <Alert className="w-full" aria-live="polite">
        Sign-in failed
      </Alert>,
    );
    const box = screen.getByRole("alert");
    expect(box.className).toContain("w-full");
    expect(box.getAttribute("aria-live")).toBe("polite");
  });
});
