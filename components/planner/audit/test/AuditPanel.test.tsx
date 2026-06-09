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
    schemaVersion: 3,
    programIds: [],
    specializationIds: {},
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
    programIds: [programId],
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
  it("renders the 'Pick a program' empty state when programIds is empty", () => {
    render(<AuditPanel plan={mkPlan()} />);
    expect(screen.queryByText(/pick a program/i)).not.toBeNull();
  });

  it("renders a master·detail panel (no combined score + one rail pip per program) for a double degree", () => {
    const engId = engineeringProgramId();
    const flexId = Object.entries(PROGRAMS).find(
      ([, p]) => p.kind === "flexible",
    )?.[0];
    if (!engId || !flexId) return;
    const { container } = render(
      <AuditPanel plan={mkPlan({ programIds: [engId, flexId] })} />,
    );
    // A labelled plan header, but NO combined percentage — hand-picked programs
    // can't be combined into one accurate score, so each is audited on its own.
    expect(screen.getByText(/plan audit/i)).toBeTruthy();
    expect(screen.getByText(/audited on its own/i)).toBeTruthy();
    expect(container.querySelector(".pw-audit-top .mp-bar")).toBeNull();
    // A slim rail with one pip per program (master), and a single detail pane.
    const pips = container.querySelectorAll(".mp-pip");
    expect(pips).toHaveLength(2);
    expect(container.querySelector(".mp-detail")).not.toBeNull();
    // The primary (first) program is selected by default.
    expect(container.querySelector(".mp-pip.is-active")).toBe(pips[0]);
    expect(container.querySelector(".mp-detail-name")?.textContent).toContain(
      PROGRAMS[engId].name.split(" (")[0],
    );
  });

  it("switches the detail pane when a different rail pip is clicked", () => {
    const engId = engineeringProgramId();
    const flexId = Object.entries(PROGRAMS).find(
      ([, p]) => p.kind === "flexible",
    )?.[0];
    if (!engId || !flexId) return;
    const { container } = render(
      <AuditPanel plan={mkPlan({ programIds: [engId, flexId] })} />,
    );
    const pips = container.querySelectorAll<HTMLButtonElement>(".mp-pip");
    fireEvent.click(pips[1]);
    expect(container.querySelector(".mp-pip.is-active")).toBe(pips[1]);
    expect(container.querySelector(".mp-detail-name")?.textContent).toContain(
      PROGRAMS[flexId].name.split(" (")[0],
    );
  });

  it("renders per-term requirements under the Degree requirements macro (not a Core Courses blob)", () => {
    // Engineering requirements live under the "Degree requirements" macro with a
    // per-term sub-label, so term titles surface and "Core Courses" does not.
    const engId = engineeringProgramId();
    expect(engId, "engineering program id not found").toBeDefined();
    if (!engId) return;
    const { container } = render(
      <AuditPanel plan={mkPlan({ programIds: [engId] })} />,
    );

    const aside = container.querySelector("aside");
    expect(aside).not.toBeNull();
    if (!aside) return;
    expect(within(aside).queryByText(/degree audit/i)).not.toBeNull();
    expect(within(aside).queryByText(/^Degree requirements$/i)).not.toBeNull();
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
        plan={mkPlan({ programIds: [engId] })}
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
        plan={mkPlan({ programIds: ["jh-applied-mathematics"] })}
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
    render(<AuditPanel plan={mkPlan({ programIds: [engId] })} />);
    // One unified course-count headline ("X/Y · N% of degree planned"), not units.
    expect(screen.getByText(/of degree planned/i)).toBeTruthy();
  });

  it("makes an unplaced course row an 'add' drag source when drill is enabled", () => {
    const engId = engineeringProgramId();
    if (!engId) return;
    const { container } = render(
      <AuditPanel
        plan={mkPlan({ programIds: [engId] })}
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
        plan={mkPlan({ programIds: [engId] })}
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
        plan={mkPlan({ programIds: [engId] })}
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
        plan={mkPlan({ programIds: [engId] })}
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
      <AuditPanel plan={mkPlan({ programIds: ["psychology-bsc"] })} />,
    );
    const aside = container.querySelector("aside");
    if (!aside) throw new Error("no aside");
    expect(within(aside).queryByText(/of degree planned/i)).not.toBeNull();
    expect(within(aside).queryByText(/of degree units/i)).toBeNull();
    expect(within(aside).queryByText(/^Degree units$/)).toBeNull();
    expect(within(aside).queryByText(/Distribution requirements/i)).toBeNull();
    expect(container.querySelector('[title*="check it by hand"]')).toBeNull();
  });

  it("drives the unified headline fraction (units) from placed courses", () => {
    // The headline IS the units bar now (no separate "courses planned" gauge):
    // two placed 0.5-unit free electives read as "1/<total> units" of progress.
    if (!("psychology-bsc" in PROGRAMS)) return;
    const { container } = render(
      <AuditPanel
        plan={oneSlotPlan("psychology-bsc", ["aaa101", "aaa102"])}
        catalog={[mkCourse("aaa101", 0.5), mkCourse("aaa102", 0.5)]}
      />,
    );
    const aside = container.querySelector("aside");
    if (!aside) throw new Error("no aside");
    // Units fraction "1/NN units", and the old "courses planned" gauge is gone.
    expect(within(aside).queryByText(/^1\/\d+(\.\d+)? units$/)).not.toBeNull();
    expect(within(aside).queryByText(/courses planned/i)).toBeNull();
  });

  it("tracks faculty breadth as a course count, not a unit note", () => {
    // h-history's "Humanities — 1.0 unit" breadth becomes a tracked "0 of 1
    // unit" requirement (in units, as the calendar states it) under "Degree
    // requirements", with its eligible subjects shown.
    if (!("h-history" in PROGRAMS)) return;
    const { container } = render(
      <AuditPanel plan={mkPlan({ programIds: ["h-history"] })} />,
    );
    const aside = container.querySelector("aside");
    if (!aside) throw new Error("no aside");
    expect(within(aside).queryByText(/degree requirements/i)).not.toBeNull();
    expect(within(aside).queryAllByText(/Humanities/i).length).toBeGreaterThan(
      0,
    );
    // Tracked in units (multiple 1.0-unit breadths share this text).
    expect(within(aside).queryAllByText(/0 of 1 unit/i).length).toBeGreaterThan(
      0,
    );
    // Eligible subjects surface in the pool card's criteria summary.
    const poolSub = aside.querySelector(".av-poolbtn-sub");
    expect(poolSub?.textContent ?? "").not.toBe("");
    expect(within(aside).queryByText(/^Degree units$/)).toBeNull();
    expect(within(aside).queryByText(/Distribution requirements/i)).toBeNull();
  });

  it("counts placed breadth units toward the requirement", () => {
    // Two 0.5-unit PHIL courses (a Humanities subject in h-history, outside the
    // major picks) make 1.0 unit → satisfies the 1.0-unit Humanities breadth.
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
    expect(within(aside).queryAllByText(/1 of 1 unit/i).length).toBeGreaterThan(
      0,
    );
  });

  it("represents the degree's open volume as a 'Free electives' row", () => {
    // h-biology pins its named requirements out of a larger degree; the
    // remainder surfaces as a "Free electives" row. It now COUNTS toward the
    // unified headline (named + free = degree total), so the bar reflects the
    // whole degree, not just named requirements.
    if (!("h-biology" in PROGRAMS)) return;
    const { container } = render(
      <AuditPanel plan={mkPlan({ programIds: ["h-biology"] })} />,
    );
    const aside = container.querySelector("aside");
    if (!aside) throw new Error("no aside");
    expect(within(aside).queryByText(/free electives/i)).not.toBeNull();
    expect(within(aside).queryByText(/of degree planned/i)).not.toBeNull();
  });

  it("renders a compound 'choose one option' as a selectable option group", () => {
    // data-science-bcs has a pick whose options are multi-course `all` bundles.
    // It must render as A/B/C selectable options with "or" separators and a
    // "Choose 1 of 3 options" header — not undifferentiated stacked blocks — and
    // the redundant "Complete all of the following" heading is dropped inside.
    if (!("data-science-bcs" in PROGRAMS)) return;
    const { container } = render(
      <AuditPanel
        plan={mkPlan({ programIds: ["data-science-bcs"] })}
        onDrillToRequirement={() => {}}
      />,
    );
    const opts = container.querySelectorAll(".av-choice-opt");
    expect(opts.length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector(".av-choice-or")).not.toBeNull();
    expect(
      within(container).queryAllByText(/choose 1 of 3 options/i).length,
    ).toBeGreaterThan(0);
    for (const opt of opts) {
      expect(opt.textContent ?? "").not.toMatch(
        /complete all of the following/i,
      );
    }
  });

  it("collapses a satisfied compound pick to a summary, expandable to the cards", () => {
    // cs480 + cs448 satisfies Option A of the data-science-bcs pick → it collapses
    // to a summary of the completed path; the full cards hide behind a toggle.
    if (!("data-science-bcs" in PROGRAMS)) return;
    const { container } = render(
      <AuditPanel
        plan={oneSlotPlan("data-science-bcs", ["cs480", "cs448"])}
        onDrillToRequirement={() => {}}
      />,
    );
    expect(
      within(container).queryAllByText(/completed.*option a/i).length,
    ).toBeGreaterThan(0);
    expect(container.querySelector(".av-opt-summary")).not.toBeNull();
    // Collapsed: the option group is not in the DOM until the toggle is clicked.
    expect(container.querySelector(".av-choice-opt")).toBeNull();
    const toggle = within(container).getByText(/show 2 other options/i);
    fireEvent.click(toggle);
    expect(container.querySelector(".av-choice-opt")).not.toBeNull();
  });

  it("organizes the audit into Degree / Electives / Co-op macro-sections", () => {
    if (!("data-science-bcs" in PROGRAMS)) return;
    const { container } = render(
      <AuditPanel
        plan={mkPlan({ programIds: ["data-science-bcs"] })}
        onDrillToRequirement={() => {}}
      />,
    );
    const labels = [...container.querySelectorAll(".av-macro-label")].map((l) =>
      l.textContent?.trim(),
    );
    expect(labels).toContain("Degree requirements");
    expect(labels).toContain("Co-op & other");
    // Electives is its own top-level macro.
    expect(labels).toContain("Electives");
  });

  it("flattens the rule tree under Degree requirements (no 'Complete all of the following' wall)", () => {
    if (!("data-science-bcs" in PROGRAMS)) return;
    const { container } = render(
      <AuditPanel
        plan={mkPlan({ programIds: ["data-science-bcs"] })}
        onDrillToRequirement={() => {}}
      />,
    );
    const aside = container.querySelector("aside");
    if (!aside) throw new Error("no aside");
    // The generic wrapper title is gone; required courses render as direct rows.
    expect(aside.textContent ?? "").not.toMatch(
      /complete all of the following/i,
    );
    const codes = [...container.querySelectorAll(".av-item-code")].map((c) =>
      c.textContent?.replace(/\s+/g, "").toUpperCase(),
    );
    expect(codes).toContain("CS341"); // a known core requirement
  });

  it("places the co-op requirement note under the 'Co-op & other' macro", () => {
    if (!("data-science-bcs" in PROGRAMS)) return;
    const { container } = render(
      <AuditPanel plan={mkPlan({ programIds: ["data-science-bcs"] })} />,
    );
    const other = [...container.querySelectorAll(".av-macro")].find((m) =>
      /co-op & other/i.test(
        m.querySelector(".av-macro-label")?.textContent ?? "",
      ),
    );
    expect(other, "expected a Co-op & other macro").toBeTruthy();
    expect(other?.textContent ?? "").toMatch(/work term/i);
  });

  it("leaves course rows inert (not draggable, no Add) without a drill handler", () => {
    const engId = engineeringProgramId();
    if (!engId) return;
    const { container } = render(
      <AuditPanel plan={mkPlan({ programIds: [engId] })} />,
    );

    // Unplaced rows still render, but with no drag affordance and no Add.
    expect(container.querySelector(".av-item")).not.toBeNull();
    expect(container.querySelector(".av-item.drag")).toBeNull();
    expect(container.querySelector(".av-item-add")).toBeNull();
  });
});
