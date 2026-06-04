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

  it("shows a count-based percent-complete headline", () => {
    const engId = engineeringProgramId();
    if (!engId) return;
    render(<AuditPanel plan={mkPlan({ programId: engId })} />);
    // Headline is the reliable course-count audit ("requirements met"), not units.
    expect(screen.getByText(/requirements met/i)).toBeTruthy();
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

  it("uses a count-based headline and no unit-allocation breakdown", () => {
    // Option A: the reliable rule-tree count drives the headline; the leaky
    // per-bucket unit layer (Degree units / Distribution rings / verify-manually
    // markers) is gone, so nothing on screen can contradict the count.
    if (!("psychology-bsc" in PROGRAMS)) return;
    const { container } = render(
      <AuditPanel plan={mkPlan({ programId: "psychology-bsc" })} />,
    );
    const aside = container.querySelector("aside");
    if (!aside) throw new Error("no aside");
    expect(within(aside).queryByText(/requirements met/i)).not.toBeNull();
    expect(within(aside).queryByText(/of degree units/i)).toBeNull();
    expect(within(aside).queryByText(/^Degree units$/)).toBeNull();
    expect(within(aside).queryByText(/Distribution requirements/i)).toBeNull();
    expect(container.querySelector('[title*="check it by hand"]')).toBeNull();
  });

  it("shows a soft 'courses planned' gauge from placed course units", () => {
    // Two 0.5u courses = 2 course-equivalents; psychology-bsc is 21 units = 42
    // courses → "≈ 2 of 42 courses planned" (a volume gauge, approximate — hence
    // "≈" and "planned" — not a completion claim).
    if (!("psychology-bsc" in PROGRAMS)) return;
    const { container } = render(
      <AuditPanel
        plan={oneSlotPlan("psychology-bsc", ["aaa101", "aaa102"])}
        catalog={[mkCourse("aaa101", 0.5), mkCourse("aaa102", 0.5)]}
      />,
    );
    const aside = container.querySelector("aside");
    if (!aside) throw new Error("no aside");
    expect(
      within(aside).queryByText(/≈\s*2 of 42 courses planned/i),
    ).not.toBeNull();
  });

  it("tracks faculty breadth as a course count, not a unit note", () => {
    // h-history's "Humanities — 1.0 unit" breadth becomes a tracked "0 of 2
    // courses" requirement under "Degree requirements", with its eligible
    // subjects shown — not a verbatim unit note, and not a unit ring that
    // contradicts the count headline.
    if (!("h-history" in PROGRAMS)) return;
    const { container } = render(
      <AuditPanel plan={mkPlan({ programId: "h-history" })} />,
    );
    const aside = container.querySelector("aside");
    if (!aside) throw new Error("no aside");
    expect(within(aside).queryByText(/degree requirements/i)).not.toBeNull();
    expect(within(aside).queryAllByText(/Humanities/i).length).toBeGreaterThan(
      0,
    );
    // 1.0 unit → 2 courses, tracked (multiple 2-course breadths share this text).
    expect(
      within(aside).queryAllByText(/0 of 2 courses/i).length,
    ).toBeGreaterThan(0);
    // Eligible subjects surface as tags.
    expect(within(aside).queryAllByText(/^CLAS$/).length).toBeGreaterThan(0);
    expect(within(aside).queryByText(/^Degree units$/)).toBeNull();
    expect(within(aside).queryByText(/Distribution requirements/i)).toBeNull();
  });

  it("counts placed breadth courses toward the requirement", () => {
    // Two PHIL courses (a Humanities subject in h-history, outside the major
    // picks) satisfy the 2-course Humanities breadth → shown as met, reading
    // "2 of 2 courses".
    if (!("h-history" in PROGRAMS)) return;
    const { container } = render(
      <AuditPanel plan={oneSlotPlan("h-history", ["phil100", "phil101"])} />,
    );
    const aside = container.querySelector("aside");
    if (!aside) throw new Error("no aside");
    expect(within(aside).queryAllByText(/PHIL\s*100/i).length).toBeGreaterThan(
      0,
    );
    expect(within(aside).queryAllByText(/PHIL\s*101/i).length).toBeGreaterThan(
      0,
    );
    expect(
      within(aside).queryAllByText(/2 of 2 courses/i).length,
    ).toBeGreaterThan(0);
  });

  it("represents the degree's open volume as an uncounted 'Free electives' note", () => {
    // h-biology pins ~21 named requirements out of a 43-course (21.5u) degree;
    // the remainder surfaces as a soft "Free electives" note so the course count
    // reconciles (named + free = degree total) — without being counted in the
    // "requirements met" headline.
    if (!("h-biology" in PROGRAMS)) return;
    const { container } = render(
      <AuditPanel plan={mkPlan({ programId: "h-biology" })} />,
    );
    const aside = container.querySelector("aside");
    if (!aside) throw new Error("no aside");
    expect(within(aside).queryByText(/free electives/i)).not.toBeNull();
    // A note, not a tracked requirement: the headline still measures named
    // requirements ("requirements met"), not the whole degree.
    expect(within(aside).queryByText(/requirements met/i)).not.toBeNull();
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
