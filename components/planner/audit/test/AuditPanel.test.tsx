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

  it("renders the headline and a single Core Courses section for an engineering program", () => {
    // Pick a real engineering program from PROGRAMS; rendering the panel
    // exercises the full summarize() pipeline against actual data. The new
    // category-based layout collapses all per-term locked courses into one
    // synthetic "Core Courses" section, so per-term letters no longer surface
    // as section titles.
    const engId = Object.entries(PROGRAMS).find(
      ([, p]) => p.kind === "engineering",
    )?.[0];
    if (!engId) {
      return;
    }
    const plan = mkPlan({ programId: engId });
    const { container } = render(<AuditPanel plan={plan} />);

    const aside = container.querySelector("aside");
    expect(aside).not.toBeNull();
    if (!aside) return;
    expect(within(aside).queryByText(/degree audit/i)).not.toBeNull();
    expect(
      within(aside).queryAllByText(/core courses/i).length,
    ).toBeGreaterThan(0);
  });

  it("exposes Missing/Placed/All filter tabs", () => {
    const engId = Object.entries(PROGRAMS).find(
      ([, p]) => p.kind === "engineering",
    )?.[0];
    if (!engId) return;
    render(<AuditPanel plan={mkPlan({ programId: engId })} />);

    expect(screen.getByRole("tab", { name: /missing/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /placed/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /^all$/i })).toBeTruthy();
  });
});
