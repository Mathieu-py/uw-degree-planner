// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the exit-animation hook. `isClosing` is driven by a mutable ref so a
// single test can flip it to assert the exit classes.
const { mockHandleClose, exitState } = vi.hoisted(() => ({
  mockHandleClose: vi.fn(),
  exitState: { isClosing: false },
}));
vi.mock("@/lib/hooks/useModalExit", () => ({
  useModalExit: () => ({
    isClosing: exitState.isClosing,
    handleClose: mockHandleClose,
  }),
}));

import { BottomSheet } from "../BottomSheet";

function renderSheet() {
  return render(
    <BottomSheet onClose={vi.fn()} titleId="sheet-title" title="Audit">
      <p>Sheet body</p>
    </BottomSheet>,
  );
}

beforeEach(() => {
  exitState.isClosing = false;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BottomSheet", () => {
  it("renders the title and children", () => {
    renderSheet();
    expect(screen.getByText("Audit")).toBeTruthy();
    expect(screen.getByText("Sheet body")).toBeTruthy();
  });

  it("calls handleClose when the backdrop is clicked", () => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Close sheet" }));
    expect(mockHandleClose).toHaveBeenCalledOnce();
  });

  it("calls handleClose when the × button is clicked", () => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(mockHandleClose).toHaveBeenCalledOnce();
  });

  it("wires aria-labelledby on the dialog to the title element", () => {
    renderSheet();
    const dialog = screen.getByRole("dialog");
    const titleId = dialog.getAttribute("aria-labelledby");
    expect(titleId).toBe("sheet-title");
    expect(document.getElementById(titleId as string)?.textContent).toBe(
      "Audit",
    );
  });

  it("applies the exit animation classes when isClosing is true", () => {
    exitState.isClosing = true;
    renderSheet();
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("translate-y-full");
    const backdrop = screen.getByRole("button", { name: "Close sheet" });
    expect(backdrop.className).toContain("opacity-0");
  });
});
