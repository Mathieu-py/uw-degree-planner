// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ThemePreviewPicker } from "../ThemePreviewPicker";
import { ThemeProvider } from "../ThemeProvider";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-mode");
});

describe("ThemePreviewPicker", () => {
  it("clicking a preview sets <html data-mode> to the chosen theme", () => {
    const { getByRole } = render(
      <ThemeProvider>
        <ThemePreviewPicker />
      </ThemeProvider>,
    );
    fireEvent.click(getByRole("radio", { name: "Dark" }));
    expect(document.documentElement.dataset.mode).toBe("dark");
    fireEvent.click(getByRole("radio", { name: "Light" }));
    expect(document.documentElement.dataset.mode).toBe("light");
  });
});
