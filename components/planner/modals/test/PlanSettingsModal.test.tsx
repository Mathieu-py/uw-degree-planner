// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type LocalPlan, PLAN_SCHEMA_VERSION } from "@/lib/plan/types";
import type { ProgramOption } from "@/lib/programs";
import { PlanSettingsModal } from "../PlanSettingsModal";

const OPTIONS: ProgramOption[] = [
  { id: "h-cs", name: "Computer Science", kind: "flexible" },
  { id: "h-math", name: "Mathematics", kind: "flexible" },
  {
    id: "software-engineering",
    name: "Software Engineering",
    kind: "engineering",
  },
  {
    id: "systems-design-engineering",
    name: "Systems Design Engineering",
    kind: "engineering",
  },
];

/** Swap the plan's single program to `name` via the multi-select palette. */
function swapProgramTo(removeName: RegExp, addName: RegExp) {
  fireEvent.click(screen.getByRole("button", { name: removeName }));
  fireEvent.click(screen.getByRole("button", { name: /add a program/i }));
  fireEvent.click(screen.getByRole("option", { name: addName }));
  fireEvent.click(screen.getByRole("button", { name: /^done$/i }));
}

/** aria-checked state of a co-op stream segment. */
function streamChecked(name: RegExp): string | null {
  return screen.getByRole("radio", { name }).getAttribute("aria-checked");
}

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

describe("PlanSettingsModal — default stream on program change (#131)", () => {
  it("suggests the new primary program's default stream", () => {
    const onSave = renderModal(
      mkPlan({ programIds: ["h-cs"], stream: "regular" }),
    );
    // CS (regular) → Software Engineering (Stream 8).
    swapProgramTo(/remove computer science/i, /software engineering/i);

    expect(streamChecked(/stream 8 co-op/i)).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        programIds: ["software-engineering"],
        stream: "stream8",
      }),
    );
  });

  it("keeps a manually chosen stream when the program changes afterwards", () => {
    const onSave = renderModal(
      mkPlan({ programIds: ["h-cs"], stream: "regular" }),
    );
    // User explicitly picks Stream 4 first…
    fireEvent.click(screen.getByRole("radio", { name: /stream 4 co-op/i }));
    // …then swaps to a program that would otherwise suggest Stream 8.
    swapProgramTo(/remove computer science/i, /software engineering/i);

    expect(streamChecked(/stream 4 co-op/i)).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ stream: "stream4" }),
    );
  });

  it("resolves Systems Design by the plan's start term", () => {
    // mkPlan starts Fall 2023 (id 1239), a pre-2026 cohort → SYDE is Stream 4.
    renderModal(mkPlan({ programIds: ["h-cs"], stream: "regular" }));
    swapProgramTo(/remove computer science/i, /systems design engineering/i);
    expect(streamChecked(/stream 4 co-op/i)).toBe("true");
  });
});
