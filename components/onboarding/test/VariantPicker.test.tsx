// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VariantGroup } from "@/lib/requirements/variantGroups";
import { VariantPicker } from "../VariantPicker";

afterEach(cleanup);

function group(over: Partial<VariantGroup> = {}): VariantGroup {
  return {
    programId: "p",
    key: "k",
    termLabel: null,
    description: "Complete 1 of the following",
    selectMin: 1,
    selectMax: 1,
    options: ["cs115", "cs135"],
    ...over,
  };
}

describe("VariantPicker", () => {
  it("single-select replaces the current choice", () => {
    const onChange = vi.fn();
    render(
      <VariantPicker
        groups={[group()]}
        value={{ k: ["cs115"] }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("CS 135"));
    expect(onChange).toHaveBeenCalledWith("k", ["cs135"]);
  });

  it("single-select re-click clears the choice (everything is skippable)", () => {
    const onChange = vi.fn();
    render(
      <VariantPicker
        groups={[group()]}
        value={{ k: ["cs115"] }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("CS 115"));
    expect(onChange).toHaveBeenCalledWith("k", []);
  });

  it("multi-select caps at selectMax and still allows deselect", () => {
    const onChange = vi.fn();
    const g = group({
      selectMin: 2,
      selectMax: 2,
      options: ["cs441", "cs442", "cs443"],
    });
    render(
      <VariantPicker
        groups={[g]}
        value={{ k: ["cs441", "cs442"] }}
        onChange={onChange}
      />,
    );
    // A third, unselected option is disabled — clicking is a no-op.
    fireEvent.click(screen.getByText("CS 443"));
    expect(onChange).not.toHaveBeenCalled();
    // Deselecting a chosen option still works.
    fireEvent.click(screen.getByText("CS 441"));
    expect(onChange).toHaveBeenCalledWith("k", ["cs442"]);
  });

  it("groups engineering picks under a term header", () => {
    render(
      <VariantPicker
        groups={[group({ termLabel: "2A", key: "e" })]}
        value={{}}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Term 2A")).toBeDefined();
  });
});
