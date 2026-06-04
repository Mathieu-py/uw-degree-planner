// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Course } from "@/lib/courses/types";
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

function mkCourse(code: string, units = 0.5): Course {
  return {
    id: 0,
    code,
    name: code.toUpperCase(),
    prereqs: null,
    coreqs: null,
    antireqs: null,
    rating: null,
    sections: [],
    units,
    prefix: code.replace(/\d.*$/, ""),
    level: Number(code.match(/\d+/)?.[0] ?? 0),
    hasSeats: true,
  };
}

function oneSlotPlan(programId: string, codes: string[]): LocalPlan {
  return mkPlan({
    programId,
    slots: [
      {
        id: "s1",
        termId: 1239,
        position: "1A",
        isCoop: false,
        courses: codes.map((code) => ({ code })),
      },
    ],
  });
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

  it("flags a genuinely unscopable unit bucket with a manual-verification marker", () => {
    // arts-and-business carries a 7.0-unit "Arts and Business courses" bucket
    // that's a meta-requirement ("complete a Faculty of Arts honours major") —
    // its rule tree has no subject pools to recover a scope from, so it stays
    // unscoped and must show a manual-verification marker + caption, not a
    // permanently-empty ring that reads like a forgotten requirement.
    if (!("arts-and-business" in PROGRAMS)) return;
    const { container } = render(
      <AuditPanel plan={mkPlan({ programId: "arts-and-business" })} />,
    );
    expect(
      container.querySelector('[title*="check it by hand"]'),
      "expected an unscoped bucket's manual-verification marker",
    ).not.toBeNull();
    expect(screen.getAllByText(/verify manually/i).length).toBeGreaterThan(0);
  });

  it("recovers an unscoped bucket's scope from rule-tree pools (psychology, no marker)", () => {
    // psychology-bsc's "Science and Mathematics" bucket IS recoverable from its
    // rule-tree subject pools, so it becomes a tracked subject bucket — clean
    // title, real ring, denominator = full 21 units, and NO verify-manually marker.
    if (!("psychology-bsc" in PROGRAMS)) return;
    const { container } = render(
      <AuditPanel plan={mkPlan({ programId: "psychology-bsc" })} />,
    );
    const aside = container.querySelector("aside");
    if (!aside) throw new Error("no aside");
    expect(container.querySelector('[title*="check it by hand"]')).toBeNull();
    expect(within(aside).queryByText(/verify manually/i)).toBeNull();
    expect(
      within(aside).queryByText(/Science and Mathematics courses/i),
      "derived bucket keeps its verbatim noun title",
    ).not.toBeNull();
    expect(within(aside).queryByText(/0\.0\s*\/\s*21 units/)).not.toBeNull();
  });

  it("counts placed units toward the total for an open-only program (not capped at the open bucket)", () => {
    // computing-and-financial-management's only unit bucket is a 2.0-unit "open
    // electives" one (its real degree is in the rule tree). A complete plan must
    // count toward the full 20.25 total, not cap at the 2.0 bucket. Place 2.5u.
    if (!("computing-and-financial-management" in PROGRAMS)) return;
    const codes = ["zzz101", "zzz102", "zzz103", "zzz104", "zzz105"];
    const { container } = render(
      <AuditPanel
        plan={oneSlotPlan("computing-and-financial-management", codes)}
        catalog={codes.map((c) => mkCourse(c, 0.5))}
      />,
    );
    const aside = container.querySelector("aside");
    if (!aside) throw new Error("no aside");
    const frac = within(aside)
      .getByText(/\/\s*20\.25 units/)
      .textContent?.replace(/\s+/g, "");
    const applied = Number(frac?.match(/([\d.]+)\/20\.25/)?.[1] ?? "0");
    expect(
      applied,
      `numerator ${applied} should exceed the 2.0 open bucket`,
    ).toBeGreaterThan(2.0);
    expect(applied).toBeCloseTo(2.5, 5);
  });

  it("renders unit-distribution constraints (previously computed but never shown)", () => {
    // science-and-business carries "3.0 units at the 200-level or above." style
    // constraints. They were audited but never rendered — surface them now.
    if (!("science-and-business" in PROGRAMS)) return;
    const { container } = render(
      <AuditPanel plan={mkPlan({ programId: "science-and-business" })} />,
    );
    const aside = container.querySelector("aside");
    if (!aside) throw new Error("no aside");
    expect(
      within(aside).queryAllByText(/200-level or above/i).length,
    ).toBeGreaterThan(0);
  });

  it("renders a subject-restricted constraint as an accurate 'X of Y units' check", () => {
    // planning has "2.0 units must be PLAN courses at the 300-level or above."
    // The audit now honors the PLAN subject + level, so it's a real check
    // ("0.0 of 2.0 units" on an empty plan) — not the old can't-verify punt.
    if (!("planning" in PROGRAMS)) return;
    const { container } = render(
      <AuditPanel plan={mkPlan({ programId: "planning" })} />,
    );
    const aside = container.querySelector("aside");
    if (!aside) throw new Error("no aside");
    expect(
      within(aside).queryAllByText(/0\.0 of 2(?:\.0)? units/i).length,
    ).toBeGreaterThan(0);
    expect(
      within(aside).queryByText(/verify the subject requirement/i),
    ).toBeNull();
  });

  it("shows a unit-stated subject pool in units, not the approximate course count", () => {
    // psychology-bsc has "5.25 units of Science courses" (selectCount 11 ≈ 5.25/0.5).
    // The rule-tree section must read in units, not the fabricated "11" count.
    if (!("psychology-bsc" in PROGRAMS)) return;
    const { container } = render(
      <AuditPanel plan={mkPlan({ programId: "psychology-bsc" })} />,
    );
    const aside = container.querySelector("aside");
    if (!aside) throw new Error("no aside");
    expect(within(aside).queryAllByText(/5\.25 units/i).length).toBeGreaterThan(
      0,
    );
    expect(within(aside).queryByText(/Any 11\b/)).toBeNull();
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
