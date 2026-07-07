// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AuditNode } from "@/lib/audit/compile";
import type { Course } from "@/lib/courses/types";
import { SectionRow } from "../../sections/SectionRow";
import type { Section } from "../../types";
import { SubjectPoolBody } from "../SubjectPoolBody";

afterEach(cleanup);

const EMPTY = new Set<string>();
const NO_CATALOG = new Map<string, Course>();

/** A subject-pool audit node — "choose N CS courses at the 300–400 level". */
function poolNode(satisfierCodes: string[], need: number): AuditNode {
  return {
    ruleNode: {
      kind: "subjectPool",
      selectCount: need,
      subjectCodes: ["cs"],
      minLevel: 300,
      maxLevel: 400,
    },
    status:
      satisfierCodes.length >= need
        ? "met"
        : satisfierCodes.length > 0
          ? "partial"
          : "unmet",
    description: `Complete ${need} additional CS courses at the 300-400-level`,
    satisfiers: satisfierCodes.map((code) => ({
      code,
      slotId: "s1",
      termId: 1239,
      position: "1A",
    })),
    missingCodes: [],
    satisfiedCount: satisfierCodes.length,
    selectMin: need,
    children: [],
  };
}

describe("Status Cards — subject pool (issue #115 headline)", () => {
  it("shows chosen chips + an 'N of M chosen' meta and a Find-courses row while in progress", () => {
    const { container } = render(
      <SubjectPoolBody
        node={poolNode(["cs341", "cs348", "cs370", "cs449", "cs456"], 6)}
        illegalCodes={EMPTY}
        catalogByCode={NO_CATALOG}
        onDrill={() => {}}
      />,
    );
    // Not receded — still an active card.
    expect(container.querySelector(".sat-a")).toBeNull();
    expect(container.querySelector(".cd-card")).not.toBeNull();
    // Progress meta + the five chosen courses shown as met chips.
    expect(container.querySelector(".cd-metaline")?.textContent).toMatch(
      /5 of 6.*chosen/i,
    );
    expect(container.querySelectorAll(".cd-chip.met")).toHaveLength(5);
    // The body ends with the Find-courses split-row, its descriptor baking in
    // the remaining count.
    const find = container.querySelector(".br4-split");
    expect(find).not.toBeNull();
    expect(find?.querySelector(".lbl")?.textContent).toBe("Add 1 more");
  });

  it("fires the pre-filtered browse drill from the Find-courses row", () => {
    const drills: Array<[string[], unknown]> = [];
    const { container } = render(
      <SubjectPoolBody
        node={poolNode(["cs341"], 6)}
        illegalCodes={EMPTY}
        catalogByCode={NO_CATALOG}
        onDrill={(codes, preset) => drills.push([codes, preset])}
      />,
    );
    fireEvent.click(container.querySelector(".br4-split") as HTMLButtonElement);
    expect(drills).toHaveLength(1);
    expect(drills[0][0]).toEqual([]);
    expect(drills[0][1]).toMatchObject({
      includePrefixes: ["CS"],
      levels: [300, 400],
    });
  });

  it("recedes to a green 'N/N' confirmation (collapsed) when the pool is complete", () => {
    const codes = ["cs341", "cs348", "cs370", "cs449", "cs456", "cs466"];
    const { container } = render(
      <SubjectPoolBody
        node={poolNode(codes, 6)}
        illegalCodes={EMPTY}
        catalogByCode={NO_CATALOG}
        onDrill={() => {}}
      />,
    );
    const recede = container.querySelector("details.sat-a");
    expect(recede, "a satisfied pool recedes to a green row").not.toBeNull();
    // Green completion count, and collapsed by default (no open attribute).
    expect(container.querySelector(".sat-a-meta")?.textContent).toBe("6/6");
    expect((recede as HTMLDetailsElement).open).toBe(false);
    // The chosen courses are the recede body's satisfier chips.
    expect(recede?.querySelectorAll(".cd-chip.met")).toHaveLength(6);
    // No Find-courses row on a completed requirement.
    expect(container.querySelector(".br4-split")).toBeNull();
  });

  it("is inert in the read-only view — no Find-courses row, no draggable chips", () => {
    const { container } = render(
      <SubjectPoolBody
        node={poolNode(["cs341", "cs348"], 6)}
        illegalCodes={EMPTY}
        catalogByCode={NO_CATALOG}
      />,
    );
    expect(container.querySelector(".br4-split")).toBeNull();
    expect(container.querySelector(".cd-chip.drag")).toBeNull();
  });
});

describe("Status Cards — notes (element I)", () => {
  it("lists each advisory constraint as its own bulleted <li>", () => {
    const items = [
      "At most 2.5 units of first-year CS may count toward the major.",
      "A minimum cumulative major average of 60% is required.",
      "No more than 5.0 units may be taken on a Credit/No-Credit basis.",
    ];
    const section: Section = {
      kind: "infoGroup",
      key: "info-0",
      title: "Additional constraint",
      items,
    };
    const { container } = render(
      <SectionRow
        section={section}
        placedCodes={EMPTY}
        illegalCodes={EMPTY}
        catalogByCode={NO_CATALOG}
        onDrill={() => {}}
      />,
    );
    const list = container.querySelector("ul.cd-notes");
    expect(list, "notes render as a <ul>").not.toBeNull();
    // Each constraint is its own <li> (bullets are drawn via ::before in CSS).
    const rows = list?.querySelectorAll("li") ?? [];
    expect(rows).toHaveLength(items.length);
    expect([...rows].map((li) => li.textContent)).toEqual(items);
  });
});

describe("Status Cards — level floor (element H)", () => {
  it("explains the missing picker with an auto-tracked lock strip", () => {
    const section: Section = {
      kind: "levelFloor",
      key: "floor-0",
      title: "Senior-level minimum",
      caption: "2.0 units at the 300-level or above",
      needUnits: 2,
      placedUnits: 1,
      subjects: [],
      satisfiers: [],
      sourceText: "",
    };
    const { container } = render(
      <SectionRow
        section={section}
        placedCodes={EMPTY}
        illegalCodes={EMPTY}
        catalogByCode={NO_CATALOG}
        onDrill={() => {}}
      />,
    );
    const auto = container.querySelector(".cd-auto");
    expect(auto, "level floor shows the auto-tracked explainer").not.toBeNull();
    expect(auto?.textContent).toMatch(/nothing to drag/i);
    expect(auto?.querySelector("svg")).not.toBeNull(); // the lock glyph
    expect(
      within(container as HTMLElement).queryByText(/1 of 2 units/i),
    ).not.toBeNull();
  });
});
