// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type LocalPlan, PLAN_SCHEMA_VERSION } from "@/lib/plan/types";
import type { ProgramOption } from "@/lib/programs";
import { PlanSettingsModal } from "../PlanSettingsModal";

const OPTIONS: ProgramOption[] = [
  { id: "h-cs", name: "Computer Science", kind: "flexible" },
  { id: "h-math", name: "Mathematics", kind: "flexible" },
];

function mkPlan(overrides: Partial<LocalPlan> = {}): LocalPlan {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    programIds: ["h-cs"],
    specializationIds: {},
    stream: "regular",
    startTermId: 1239,
    slots: [],
    updatedAt: "2026-05-23T12:00:00.000Z",
    ...overrides,
  };
}

function renderModal(plan: LocalPlan, onSave = vi.fn()) {
  render(
    <PlanSettingsModal
      plan={plan}
      programOptions={OPTIONS}
      specializationsByProgram={{}}
      onClose={vi.fn()}
      onSave={onSave}
    />,
  );
  return onSave;
}

afterEach(cleanup);

describe("PlanSettingsModal — min-one-program guard", () => {
  it("disables Save and shows a hint when the last program is removed", () => {
    renderModal(mkPlan({ programIds: ["h-cs"] }));
    const save = screen.getByRole<HTMLButtonElement>("button", {
      name: /save changes/i,
    });
    // Pristine plan: nothing dirty yet, so Save is disabled for that reason.
    expect(save.disabled).toBe(true);

    // Remove the only program → empty selection.
    fireEvent.click(
      screen.getByRole("button", { name: /remove computer science/i }),
    );

    // Now the form is dirty, but Save stays disabled because zero programs is
    // not a savable state, and the guard hint appears.
    expect(save.disabled).toBe(true);
    expect(screen.getByText(/pick at least one program/i)).toBeTruthy();
  });

  it("re-enables Save once a program is added back", () => {
    const onSave = renderModal(mkPlan({ programIds: ["h-cs"] }));
    fireEvent.click(
      screen.getByRole("button", { name: /remove computer science/i }),
    );

    const save = screen.getByRole<HTMLButtonElement>("button", {
      name: /save changes/i,
    });
    expect(save.disabled).toBe(true);

    // Add a different program via the search palette: open it, pick Mathematics,
    // then close it so the Save button underneath is reachable again.
    fireEvent.click(screen.getByRole("button", { name: /add a program/i }));
    fireEvent.click(screen.getByRole("option", { name: /mathematics/i }));
    fireEvent.click(screen.getByRole("button", { name: /^done$/i }));

    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ programIds: ["h-math"] }),
    );
  });
});
