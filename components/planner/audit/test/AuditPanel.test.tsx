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

// An engineering program with an empty plan leaves every required course
// unplaced, so the panel renders draggable `.av-item.drag` course rows.
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

  it("renders per-term sections for an engineering program (not a Core Courses blob)", () => {
    // The redesign replaces the synthetic "Core Courses" blob with one section
    // per academic term, so term titles surface and "Core Courses" does not.
    const engId = engineeringProgramId();
    expect(engId, "engineering program id not found").toBeDefined();
    if (!engId) return;
    const { container } = render(
      <AuditPanel plan={mkPlan({ programId: engId })} />,
    );

    const aside = container.querySelector("aside");
    expect(aside).not.toBeNull();
    if (!aside) return;
    expect(within(aside).queryByText(/degree audit/i)).not.toBeNull();
    // "Academic terms" appears in both the group heading and the header
    // caption ("8 academic terms · …"), so just assert it's present.
    expect(
      within(aside).queryAllByText(/academic terms/i).length,
    ).toBeGreaterThan(0);
    expect(within(aside).queryByText(/term 1a/i)).not.toBeNull();
    expect(within(aside).queryByText(/core courses/i)).toBeNull();
  });

  it("renders draggable option chips for a 'choose one' (pick) requirement", () => {
    // The compiler unions a pick's `courses` leaves into one pool and leaves
    // `node.children` empty, so the options must be read off the rule node.
    // Regression guard: a "choose one" row must show its option chips.
    const engId = engineeringProgramId();
    if (!engId) return;
    const { container } = render(
      <AuditPanel
        plan={mkPlan({ programId: engId })}
        onDrillToRequirement={() => {}}
      />,
    );

    const choose = container.querySelector(".av-choose");
    expect(choose, "expected at least one 'choose one' row").not.toBeNull();
    expect(container.querySelectorAll(".av-chip.drag").length).toBeGreaterThan(
      0,
    );
  });

  it("flattens a 1-of-1 pick over nested single-course choices into one card", () => {
    // jh-applied-mathematics has a pick: "choose 1 of { AMATH 271, one-of{AMATH
    // 333, …} }". That's a flat 1-of-N, so it must render as ONE "choose one"
    // card containing AMATH 271 alongside AMATH 333 — not a course row plus a
    // separate nested choice card.
    if (!("jh-applied-mathematics" in PROGRAMS)) return;
    const { container } = render(
      <AuditPanel
        plan={mkPlan({ programId: "jh-applied-mathematics" })}
        onDrillToRequirement={() => {}}
      />,
    );
    const norm = (t: string) => t.replace(/\s+/g, "").toUpperCase();
    const grouped = [...container.querySelectorAll(".av-choose")].some(
      (row) => {
        const chips = [...row.querySelectorAll(".av-chip")].map((c) =>
          norm(c.textContent ?? ""),
        );
        return chips.includes("AMATH271") && chips.includes("AMATH333");
      },
    );
    expect(
      grouped,
      "AMATH 271 and AMATH 333 should share one choose-one card",
    ).toBe(true);
    // And AMATH 271 must NOT also appear as a standalone required course row.
    const rowCodes = [...container.querySelectorAll(".av-item-code")].map((c) =>
      norm(c.textContent ?? ""),
    );
    expect(rowCodes).not.toContain("AMATH271");
  });

  it("shows the overall percent-complete headline", () => {
    const engId = engineeringProgramId();
    if (!engId) return;
    render(<AuditPanel plan={mkPlan({ programId: engId })} />);
    // Engineering states a degree total (no distribution buckets), so the
    // headline reports unit progress rather than a requirement count.
    expect(screen.getByText(/of degree units/i)).toBeTruthy();
  });

  it("makes an unplaced course row an 'add' drag source when drill is enabled", () => {
    const engId = engineeringProgramId();
    if (!engId) return;
    const { container } = render(
      <AuditPanel
        plan={mkPlan({ programId: engId })}
        onDrillToRequirement={() => {}}
      />,
    );

    const row = container.querySelector(".av-item.drag");
    expect(row, "expected at least one draggable course row").not.toBeNull();
    if (!row) return;
    expect(row.getAttribute("draggable")).toBe("true");

    const dt = fakeDataTransfer();
    fireEvent.dragStart(row, { dataTransfer: dt });
    expect(JSON.parse(dt.getData(COURSE_DRAG_MIME))).toMatchObject({
      kind: "add",
    });
  });

  it("clicking a course row's Add button drills into the requirement", () => {
    const engId = engineeringProgramId();
    if (!engId) return;
    const drilled: string[][] = [];
    const { container } = render(
      <AuditPanel
        plan={mkPlan({ programId: engId })}
        onDrillToRequirement={(codes) => drilled.push(codes)}
      />,
    );

    const add = container.querySelector<HTMLButtonElement>(".av-item-add");
    expect(add).not.toBeNull();
    if (!add) return;

    fireEvent.click(add);
    expect(drilled).toHaveLength(1);
    expect(drilled[0]).toHaveLength(1);
  });

  it("fires the drag lifecycle and dims the in-flight row", () => {
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

    const row = container.querySelector(".av-item.drag");
    if (!row) return;
    fireEvent.dragStart(row, { dataTransfer: fakeDataTransfer() });
    expect(started).not.toBeNull();
    fireEvent.dragEnd(row);
    expect(ended).toBe(1);

    // With that code marked as dragging, its row dims (.dim).
    rerender(
      <AuditPanel
        plan={mkPlan({ programId: engId })}
        onDrillToRequirement={() => {}}
        drag={{ draggingCode: started, onStart: () => {}, onEnd: () => {} }}
      />,
    );
    expect(container.querySelector(".av-item.dim")).not.toBeNull();
  });

  it("flags an unscoped unit bucket with a manual-verification marker, not a 0% ring", () => {
    // psychology-bsc carries a 9.5-unit "Science and Mathematics" bucket whose
    // scope we can't verify. It must show a manual-verification marker (with a
    // "check it by hand" affordance) and say so in the caption, instead of a
    // permanently-empty progress ring that reads like a forgotten requirement.
    if (!("psychology-bsc" in PROGRAMS)) return;
    const { container } = render(
      <AuditPanel plan={mkPlan({ programId: "psychology-bsc" })} />,
    );
    expect(
      container.querySelector('[title*="check it by hand"]'),
      "expected an unscoped bucket's manual-verification marker",
    ).not.toBeNull();
    expect(screen.getAllByText(/verify manually/i).length).toBeGreaterThan(0);
  });

  it("leaves course rows inert (not draggable, no Add) without a drill handler", () => {
    const engId = engineeringProgramId();
    if (!engId) return;
    const { container } = render(
      <AuditPanel plan={mkPlan({ programId: engId })} />,
    );

    // Unplaced rows still render, but with no drag affordance and no Add.
    expect(container.querySelector(".av-item")).not.toBeNull();
    expect(container.querySelector(".av-item.drag")).toBeNull();
    expect(container.querySelector(".av-item-add")).toBeNull();
  });
});
