import { describe, expect, it } from "vitest";
import {
  antireqConflictGroups,
  countPlacementIssues,
  creditExclusionKeys,
} from "../creditExclusion";

describe("antireqConflictGroups", () => {
  it("collapses a symmetric pair (two issues) into one group", () => {
    const groups = antireqConflictGroups([
      {
        slotId: "s1",
        courseCode: "cs115",
        kind: "antireq",
        conflictsWith: ["ece150"],
      },
      {
        slotId: "s2",
        courseCode: "ece150",
        kind: "antireq",
        conflictsWith: ["cs115"],
      },
      { slotId: "s3", courseCode: "cs350", kind: "prereq" }, // not antireq — ignored
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((m) => m.code).sort()).toEqual(["cs115", "ece150"]);
  });

  it("forms one group from a one-directional edge (only one course names the other)", () => {
    const groups = antireqConflictGroups([
      {
        slotId: "s1",
        courseCode: "cs115",
        kind: "antireq",
        conflictsWith: ["ece150"],
      },
      {
        slotId: "s2",
        courseCode: "ece150",
        kind: "antireq",
        conflictsWith: [],
      },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((m) => m.code).sort()).toEqual(["cs115", "ece150"]);
  });
});

describe("creditExclusionKeys", () => {
  const unitsOf = () => 0.5;

  it("keeps all prereq keys and excludes only the non-keeper of an antireq set", () => {
    const keys = creditExclusionKeys(
      [
        { slotId: "s0", courseCode: "cs350", kind: "prereq" },
        {
          slotId: "s1",
          courseCode: "cs114",
          kind: "antireq",
          conflictsWith: ["cs136"],
        },
        {
          slotId: "s2",
          courseCode: "cs136",
          kind: "antireq",
          conflictsWith: ["cs114"],
        },
      ],
      { referenced: new Set(["cs136"]), unitsOf },
    );
    // Prereq held out; CS 136 is required (referenced) → kept; CS 114 excluded.
    expect([...keys].sort()).toEqual(["s0::cs350", "s1::cs114"]);
  });

  it("falls back to higher units when neither member is referenced", () => {
    const keys = creditExclusionKeys(
      [
        {
          slotId: "s1",
          courseCode: "aaa100",
          kind: "antireq",
          conflictsWith: ["bbb200"],
        },
        {
          slotId: "s2",
          courseCode: "bbb200",
          kind: "antireq",
          conflictsWith: ["aaa100"],
        },
      ],
      {
        referenced: new Set(),
        unitsOf: (c) => (c === "bbb200" ? 1.0 : 0.5),
      },
    );
    // bbb200 has more units → kept; aaa100 excluded.
    expect([...keys]).toEqual(["s1::aaa100"]);
  });
});

describe("countPlacementIssues", () => {
  it("counts one per prereq course and one per antireq conflict SET", () => {
    const n = countPlacementIssues([
      { slotId: "s0", courseCode: "cs350", kind: "prereq" },
      {
        slotId: "s1",
        courseCode: "cs115",
        kind: "antireq",
        conflictsWith: ["ece150"],
      },
      {
        slotId: "s2",
        courseCode: "ece150",
        kind: "antireq",
        conflictsWith: ["cs115"],
      },
      { slotId: "s3", courseCode: "se212", kind: "coreq" }, // advisory — ignored
    ]);
    // 1 prereq + 1 antireq pair (not 2) = 2.
    expect(n).toBe(2);
  });
});
