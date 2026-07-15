// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AuditNode } from "@/lib/audit/compile";
import { type ScoreInputs, scoreNode } from "@/lib/audit/score";
import type { Section } from "@/lib/audit/view/types";
import type { Course } from "@/lib/courses/types";
import { SectionRow } from "../../sections/SectionRow";
import { ChooseOneRow } from "../ChooseOneRow";
import { CompoundPickBody } from "../CompoundPick";
import { NodeBody } from "../NodeBody";
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

/** A flat 1-of-N pick over single courses — the ChooseOneRow shape. */
function choicePick(satisfierCodes: string[], options: string[]): AuditNode {
  return {
    ruleNode: {
      kind: "pick",
      selectMin: 1,
      selectMax: 1,
      children: [{ kind: "courses", courses: options }],
    },
    status: satisfierCodes.length > 0 ? "met" : "unmet",
    satisfiers: satisfierCodes.map((code) => ({
      code,
      slotId: "s1",
      termId: 1239,
      position: "1A",
    })),
    missingCodes: [],
    satisfiedCount: satisfierCodes.length,
    selectMin: 1,
    selectMax: 1,
    children: [],
  };
}

describe("Status Cards — subject pool (issue #115 headline)", () => {
  it("shows chosen chips + an 'N of M chosen' meta and a Find-courses row while in progress", () => {
    const { container } = render(
      <SubjectPoolBody
        scored={scoreNode(
          poolNode(["cs341", "cs348", "cs370", "cs449", "cs456"], 6),
        )}
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
        scored={scoreNode(poolNode(["cs341"], 6))}
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
        scored={scoreNode(poolNode(codes, 6))}
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
        scored={scoreNode(poolNode(["cs341", "cs348"], 6))}
        illegalCodes={EMPTY}
        catalogByCode={NO_CATALOG}
      />,
    );
    expect(container.querySelector(".br4-split")).toBeNull();
    expect(container.querySelector(".cd-chip.drag")).toBeNull();
  });

  it("does NOT recede when the count is met only via an illegal placement (legallyMet false)", () => {
    // The compiler marks a pool met-but-flagged (`legallyMet: false`) when a
    // load-bearing satisfier is placed illegally. The card must stay active.
    const node = { ...poolNode(["cs341", "cs350"], 2), legallyMet: false };
    const { container } = render(
      <SubjectPoolBody
        scored={scoreNode(node)}
        illegalCodes={new Set(["cs350"])}
        catalogByCode={NO_CATALOG}
        onDrill={() => {}}
      />,
    );
    expect(container.querySelector(".sat-a")).toBeNull(); // not receded
    expect(container.querySelector(".cd-card")).not.toBeNull();
    // The illegal course shows amber (warn), never a green "met" chip.
    expect(container.querySelector(".cd-chip.warn")).not.toBeNull();
  });
});

describe("Status Cards — choose-one pick (element B) legality", () => {
  it("does NOT recede when the choice is met only via an illegal placement (legallyMet false)", () => {
    // The compiler marks the pick met-but-flagged when its only satisfier is
    // placed illegally. The row must stay an active card, not a green recede.
    const node = {
      ...choicePick(["cs350"], ["cs341", "cs350"]),
      legallyMet: false,
    };
    const { container } = render(
      <ChooseOneRow
        scored={scoreNode(node)}
        options={["cs341", "cs350"]}
        illegalCodes={new Set(["cs350"])}
        catalogByCode={NO_CATALOG}
        onDrill={() => {}}
      />,
    );
    expect(container.querySelector(".sat-a")).toBeNull(); // not receded
    expect(container.querySelector(".cd-card")).not.toBeNull();
    // The illegal placement shows amber (warn), never a green "met" chip.
    expect(container.querySelector(".cd-chip.warn")).not.toBeNull();
    expect(container.querySelector(".cd-chip.met")).toBeNull();
  });

  it("recedes to the chosen course once the choice is legally satisfied", () => {
    const { container } = render(
      <ChooseOneRow
        scored={scoreNode(choicePick(["cs341"], ["cs341", "cs350"]))}
        options={["cs341", "cs350"]}
        illegalCodes={EMPTY}
        catalogByCode={NO_CATALOG}
        onDrill={() => {}}
      />,
    );
    const recede = container.querySelector("details.sat-a");
    expect(recede, "a legally decided choice recedes").not.toBeNull();
    expect(recede?.querySelectorAll(".cd-chip.met")).toHaveLength(1);
  });
});

describe("Status Cards — match-scored path (the production shape)", () => {
  /** Hand-built ScoreInputs: fill/assigned for exactly the given nodes. */
  function matchInputs(entries: Array<[AuditNode, string[]]>): ScoreInputs {
    const nodeFill = new WeakMap<AuditNode, number>();
    const nodeAssigned = new WeakMap<AuditNode, string[]>();
    for (const [n, codes] of entries) {
      nodeFill.set(n, codes.length);
      if (codes.length > 0) nodeAssigned.set(n, codes);
    }
    return { nodeFill, nodeAssigned };
  }

  /** An all-required `courses` leaf — the RequiredCoursesCard shape. */
  function coursesNode(satisfierCodes: string[], missing: string[]): AuditNode {
    return {
      ruleNode: { kind: "courses", courses: [...satisfierCodes, ...missing] },
      status:
        missing.length === 0
          ? "met"
          : satisfierCodes.length > 0
            ? "partial"
            : "unmet",
      satisfiers: satisfierCodes.map((code) => ({
        code,
        slotId: "s1",
        termId: 1239,
        position: "1A",
      })),
      missingCodes: missing,
      children: [],
    };
  }

  it("a legally-met pick whose option was credited elsewhere does NOT recede", () => {
    const node = choicePick(["cs341"], ["cs341", "cs350"]);
    // Match present, but this pick's bucket got nothing (claimed elsewhere).
    const { container } = render(
      <ChooseOneRow
        scored={scoreNode(node, matchInputs([[node, []]]))}
        options={["cs341", "cs350"]}
        illegalCodes={EMPTY}
        catalogByCode={NO_CATALOG}
        onDrill={() => {}}
      />,
    );
    expect(container.querySelector(".sat-a")).toBeNull(); // not receded
    expect(container.querySelector(".cd-card")).not.toBeNull();
  });

  it("a receded pick keeps the WarnChip for an illegally-placed option", () => {
    // CS 341 placed legally (credited); CS 350 also placed but illegal — the
    // warning must survive the recede (credited codes are always legal).
    const node = choicePick(["cs341", "cs350"], ["cs341", "cs350"]);
    const { container } = render(
      <ChooseOneRow
        scored={scoreNode(node, matchInputs([[node, ["cs341"]]]))}
        options={["cs341", "cs350"]}
        illegalCodes={new Set(["cs350"])}
        catalogByCode={NO_CATALOG}
        onDrill={() => {}}
      />,
    );
    const recede = container.querySelector("details.sat-a");
    expect(recede).not.toBeNull();
    expect(recede?.querySelectorAll(".cd-chip.met")).toHaveLength(1);
    expect(recede?.querySelectorAll(".cd-chip.warn")).toHaveLength(1);
  });

  it("a receded pool chips only what credited it, plus illegal satisfiers", () => {
    const node = poolNode(["cs341", "cs348", "cs350"], 2);
    const scored = scoreNode(node, matchInputs([[node, ["cs341", "cs348"]]]));
    const { container } = render(
      <SubjectPoolBody
        scored={scored}
        illegalCodes={new Set(["cs350"])}
        catalogByCode={NO_CATALOG}
        onDrill={() => {}}
      />,
    );
    const recede = container.querySelector("details.sat-a");
    expect(recede).not.toBeNull();
    // The two credited courses chip green; the illegal third warns; a legal
    // satisfier claimed elsewhere would not be re-shown.
    expect(recede?.querySelectorAll(".cd-chip.met")).toHaveLength(2);
    expect(recede?.querySelectorAll(".cd-chip.warn")).toHaveLength(1);
  });

  it("required-courses metaline counts placements even with zero match credit", () => {
    // Both placed codes' singleton buckets are owned by an earlier leaf naming
    // the same courses (progress.ts `required` is first-wins) — the card must
    // still read "2 of 3", agreeing with its placed chips, not "0 of 3".
    const node = coursesNode(["math235", "math239"], ["stat230"]);
    const { container } = render(
      <NodeBody
        scored={scoreNode(node, matchInputs([[node, []]]))}
        placedCodes={new Set(["math235", "math239"])}
        illegalCodes={EMPTY}
        catalogByCode={NO_CATALOG}
        onDrill={() => {}}
      />,
    );
    expect(container.querySelector(".sat-a")).toBeNull(); // stat230 missing
    expect(container.querySelector(".cd-metaline")?.textContent).toMatch(
      /2 of 3/,
    );
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

/** A compound pick whose options are subject pools — the shape that used to
 * render empty "0/0" cards with no chips and no browse. */
function compoundPoolPick(
  optA: AuditNode,
  optB: AuditNode,
  decided: boolean,
): AuditNode {
  return {
    ruleNode: {
      kind: "pick",
      selectMin: 1,
      selectMax: 1,
      children: [optA.ruleNode, optB.ruleNode],
    },
    status: decided ? "met" : "partial",
    satisfiers: [...optA.satisfiers, ...optB.satisfiers],
    missingCodes: [],
    satisfiedCount: decided ? 1 : 0,
    selectMin: 1,
    selectMax: 1,
    children: [optA, optB],
  };
}

describe("Status Cards — compound pick with subject-pool options (issue #115)", () => {
  it("renders a pool option's placed chips + a scoped Find-courses row (not an empty 0/0 card)", () => {
    const drills: Array<[string[], unknown]> = [];
    const { container } = render(
      <CompoundPickBody
        scored={scoreNode(
          compoundPoolPick(poolNode(["cs341"], 2), poolNode([], 3), false),
        )}
        placedCodes={new Set(["cs341"])}
        illegalCodes={EMPTY}
        catalogByCode={NO_CATALOG}
        onDrill={(codes, preset) => drills.push([codes, preset])}
      />,
    );
    // Active card with two option sub-cards (not receded).
    expect(container.querySelector(".sat-a")).toBeNull();
    expect(container.querySelectorAll(".cd-opt")).toHaveLength(2);
    // The placed pool course shows as a met chip — the body is NOT empty.
    const met = [...container.querySelectorAll(".cd-chip.met")].map((c) =>
      c.textContent?.replace(/\s+/g, "").toUpperCase(),
    );
    expect(met).toContain("CS341");
    // Each pool option offers a browse row…
    const finds = container.querySelectorAll(".br4-split");
    expect(finds.length).toBeGreaterThanOrEqual(1);
    // …and the per-option mini reflects the real need (1 of 2 / 0 of 3), never "0/0".
    const minis = [...container.querySelectorAll(".cd-opt-mini")].map(
      (m) => m.textContent,
    );
    expect(minis).toContain("1/2");
    expect(minis).not.toContain("0/0");
    // The browse drill carries the pool's subject/level preset.
    fireEvent.click(finds[0] as HTMLButtonElement);
    expect(drills[0][0]).toEqual([]);
    expect(drills[0][1]).toMatchObject({
      includePrefixes: ["CS"],
      levels: [300, 400],
    });
  });

  it("recedes to a green row listing the completed pool stream's courses", () => {
    const { container } = render(
      <CompoundPickBody
        scored={scoreNode(
          compoundPoolPick(
            poolNode(["cs341", "cs350"], 2),
            poolNode([], 3),
            true,
          ),
        )}
        placedCodes={new Set(["cs341", "cs350"])}
        illegalCodes={EMPTY}
        catalogByCode={NO_CATALOG}
        onDrill={() => {}}
      />,
    );
    const recede = container.querySelector("details.sat-a");
    expect(recede, "a satisfied compound pool recedes").not.toBeNull();
    // The completed stream's courses appear as met chips (body is NOT empty).
    expect(recede?.querySelectorAll(".cd-chip.met")).toHaveLength(2);
    // The unchosen option hides behind the toggle.
    expect(
      within(container as HTMLElement).queryByText(/show 1 other option/i),
    ).not.toBeNull();
  });

  it("does NOT recede when the completed option's satisfier is illegal (legallyMet false)", () => {
    // Parent status says "met", but `decided` is recomputed from
    // isLegallyMet(option) — the flagged option must not collapse the card.
    const optA = { ...poolNode(["cs341", "cs350"], 2), legallyMet: false };
    const { container } = render(
      <CompoundPickBody
        scored={scoreNode(compoundPoolPick(optA, poolNode([], 3), true))}
        placedCodes={new Set(["cs341", "cs350"])}
        illegalCodes={new Set(["cs350"])}
        catalogByCode={NO_CATALOG}
        onDrill={() => {}}
      />,
    );
    expect(container.querySelector(".sat-a")).toBeNull(); // not receded
    expect(container.querySelector(".cd-card")).not.toBeNull();
    // The illegal placement is flagged amber; the legal one stays green.
    const codes = (sel: string) =>
      [...container.querySelectorAll(sel)].map((c) =>
        c.textContent?.replace(/\s+/g, "").toUpperCase(),
      );
    expect(codes(".cd-chip.warn")).toContain("CS350");
    expect(codes(".cd-chip.met")).toContain("CS341");
  });
});
