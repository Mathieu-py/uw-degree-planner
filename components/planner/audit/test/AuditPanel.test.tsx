// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { COURSE_DRAG_MIME } from "@/lib/plan/dnd";
import { fakeDataTransfer } from "@/lib/plan/test/fakeDataTransfer";
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

// An engineering program with an empty plan leaves every core course missing,
// so the panel renders `.pw-areq.is-miss` chips to drag from.
function engineeringProgramId(): string | undefined {
  return Object.entries(PROGRAMS).find(
    ([, p]) => p.kind === "engineering",
  )?.[0];
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
    expect(
      engId,
      "engineering program id not found in PROGRAMS fixture",
    ).toBeDefined();
    if (!engId) return;
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

  it("shows the overall percent-complete headline", () => {
    // The redesign replaced the Missing/Placed/All filter tabs with a single
    // "% requirements met" headline + progress bar; met and missing chips now
    // render together per requirement group.
    const engId = Object.entries(PROGRAMS).find(
      ([, p]) => p.kind === "engineering",
    )?.[0];
    expect(
      engId,
      "engineering program id not found in PROGRAMS fixture",
    ).toBeDefined();
    if (!engId) return;
    render(<AuditPanel plan={mkPlan({ programId: engId })} />);

    expect(screen.getByText(/requirements met/i)).toBeTruthy();
  });

  it("makes the whole missing chip an 'add' drag source when drill is enabled", () => {
    const engId = engineeringProgramId();
    if (!engId) return;
    const { container } = render(
      <AuditPanel
        plan={mkPlan({ programId: engId })}
        onDrillToRequirement={() => {}}
      />,
    );

    const chip = container.querySelector(".pw-areq.is-miss");
    expect(chip, "expected at least one missing chip").not.toBeNull();
    if (!chip) return;
    // The chip itself is draggable, so the chip (with its code) is the drag
    // preview — not a separate handle.
    expect(chip.tagName).toBe("BUTTON");
    expect(chip.getAttribute("draggable")).toBe("true");

    const dt = fakeDataTransfer();
    fireEvent.dragStart(chip, { dataTransfer: dt });
    expect(JSON.parse(dt.getData(COURSE_DRAG_MIME))).toMatchObject({
      kind: "add",
    });
  });

  it("clicking a missing chip drills into the requirement", () => {
    const engId = engineeringProgramId();
    if (!engId) return;
    const drilled: string[][] = [];
    const { container } = render(
      <AuditPanel
        plan={mkPlan({ programId: engId })}
        onDrillToRequirement={(codes) => drilled.push(codes)}
      />,
    );

    const chip = container.querySelector<HTMLButtonElement>(".pw-areq.is-miss");
    expect(chip).not.toBeNull();
    if (!chip) return;

    fireEvent.click(chip);
    expect(drilled).toHaveLength(1);
    expect(drilled[0]).toHaveLength(1);
  });

  it("fires the drag lifecycle and dims the in-flight chip", () => {
    const engId = engineeringProgramId();
    if (!engId) return;
    let started: string | null = null;
    let ended = 0;
    const { container, rerender } = render(
      <AuditPanel
        plan={mkPlan({ programId: engId })}
        onDrillToRequirement={() => {}}
        drag={{
          draggingCode: null,
          onStart: (c) => {
            started = c;
          },
          onEnd: () => {
            ended += 1;
          },
        }}
      />,
    );

    const chip = container.querySelector(".pw-areq.is-miss");
    if (!chip) return;
    fireEvent.dragStart(chip, { dataTransfer: fakeDataTransfer() });
    expect(started).not.toBeNull();
    fireEvent.dragEnd(chip);
    expect(ended).toBe(1);

    // With that code marked as dragging, its chip dims (is-placing).
    rerender(
      <AuditPanel
        plan={mkPlan({ programId: engId })}
        onDrillToRequirement={() => {}}
        drag={{ draggingCode: started, onStart: () => {}, onEnd: () => {} }}
      />,
    );
    expect(container.querySelector(".pw-areq.is-placing")).not.toBeNull();
  });

  it("leaves missing chips inert (an inert span, not draggable) without a drill handler", () => {
    const engId = engineeringProgramId();
    if (!engId) return;
    const { container } = render(
      <AuditPanel plan={mkPlan({ programId: engId })} />,
    );

    const chip = container.querySelector(".pw-areq.is-miss");
    expect(chip).not.toBeNull();
    expect(chip?.tagName).toBe("SPAN");
    expect(chip?.getAttribute("draggable")).not.toBe("true");
    expect(container.querySelector("button.pw-areq")).toBeNull();
  });
});
