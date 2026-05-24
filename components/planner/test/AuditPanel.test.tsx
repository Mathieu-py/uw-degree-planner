// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { LocalPlan } from "@/lib/plan/types";
import { PROGRAMS } from "@/lib/programs";
import { AuditPanel } from "../AuditPanel";

afterEach(cleanup);

function mkPlan(overrides: Partial<LocalPlan> = {}): LocalPlan {
  return {
    schemaVersion: 1,
    programId: null,
    specializationId: null,
    stream: "regular",
    startTermId: 1239,
    slots: [],
    updatedAt: "2026-05-23T12:00:00.000Z",
    ...overrides,
  };
}

describe("AuditPanel", () => {
  it("renders the 'Pick a program' empty state when plan.programId is null", () => {
    render(<AuditPanel plan={mkPlan()} />);
    expect(screen.queryByText(/pick a program/i)).not.toBeNull();
  });

  it("renders byTerm sections with the headline once a real engineering program is set", () => {
    // Pick a real engineering program from PROGRAMS; rendering the panel
    // exercises the full summarize() pipeline against actual data.
    const engId = Object.entries(PROGRAMS).find(
      ([, p]) => p.kind === "engineering",
    )?.[0];
    if (!engId) {
      // The data file currently contains engineering programs; this guard
      // just makes the test resilient to data shape changes.
      return;
    }
    const plan = mkPlan({ programId: engId });
    const { container } = render(<AuditPanel plan={plan} />);

    // Headline element: the panel's top card carries the "Degree audit" label
    // exactly once even when many sections render below.
    const aside = container.querySelector("aside");
    expect(aside).not.toBeNull();
    if (!aside) return;
    expect(within(aside).queryByText(/degree audit/i)).not.toBeNull();

    // Each of the 8 term letters should appear as a section title.
    for (const t of ["1A", "1B", "2A", "2B", "3A", "3B", "4A", "4B"] as const) {
      expect(within(aside).queryAllByText(t).length).toBeGreaterThan(0);
    }
  });
});
