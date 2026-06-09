import { describe, expect, it } from "vitest";
import type { LocalPlan } from "../../plan/types";
import type { Program, RuleNode } from "../../programs";
import {
  antireqConflictGroups,
  compileAudit,
  countPlacementIssues,
  creditExclusionKeys,
  summarize,
} from "../compile";
import { buildPlacementMap } from "../placement";

function makePlan(slots: LocalPlan["slots"]): LocalPlan {
  return {
    schemaVersion: 3,
    programIds: ["test"],
    specializationIds: {},
    stream: "regular",
    startTermId: 1239,
    slots,
    updatedAt: "2026-05-23T12:00:00.000Z",
  };
}

function slot(
  id: string,
  termId: number | null,
  codes: string[],
): LocalPlan["slots"][number] {
  return {
    id,
    termId,
    position: "1A",
    isCoop: false,
    courses: codes.map((c) => ({ code: c })),
  };
}

describe("buildPlacementMap", () => {
  it("indexes every placed course back to its slot", () => {
    const plan = makePlan([slot("s1", 1239, ["cs115", "math115"])]);
    const map = buildPlacementMap(plan);
    expect(map.get("cs115")?.slotId).toBe("s1");
    expect(map.get("math115")?.termId).toBe(1239);
    expect(map.get("missing")).toBeUndefined();
  });

  it("skips no-credit attempts (failed/withdrawn) but keeps a passed retake", () => {
    const plan = makePlan([
      {
        id: "s1",
        termId: 1239,
        position: "1A",
        isCoop: false,
        courses: [
          { code: "cs135", grade: "40" }, // failed → excluded
          { code: "cs136", grade: "WD" }, // withdrawn → excluded
          { code: "math115", grade: "75" }, // passed → kept
          { code: "math116" }, // not yet graded (planned) → kept
        ],
      },
      {
        id: "s2",
        termId: 1241,
        position: "1B",
        isCoop: false,
        courses: [{ code: "cs135", grade: "70" }], // passed retake → kept
      },
    ]);
    const map = buildPlacementMap(plan);
    expect(map.get("cs135")?.slotId).toBe("s2"); // the passed attempt, not the fail
    expect(map.has("cs136")).toBe(false); // withdrawn, no retake
    expect(map.has("math115")).toBe(true);
    expect(map.has("math116")).toBe(true); // planned (no grade) still counts
  });
});

describe("compileAudit — engineering program, courses-under-all", () => {
  const program: Program = {
    kind: "engineering",
    name: "Toy",
    asOf: "2026",
    terms: {
      "1A": {
        kind: "all",
        children: [{ kind: "courses", courses: ["cs115", "math115"] }],
      },
      "1B": {
        kind: "all",
        children: [{ kind: "courses", courses: ["cs136"] }],
      },
      "2A": {
        kind: "all",
        children: [{ kind: "courses", courses: ["se212"] }],
      },
      "2B": {
        kind: "all",
        children: [{ kind: "courses", courses: ["se350"] }],
      },
      "3A": {
        kind: "all",
        children: [{ kind: "courses", courses: ["se463"] }],
      },
      "3B": {
        kind: "all",
        children: [{ kind: "courses", courses: ["se464"] }],
      },
      "4A": {
        kind: "all",
        children: [{ kind: "courses", courses: ["se490"] }],
      },
      "4B": {
        kind: "all",
        children: [{ kind: "courses", courses: ["se491"] }],
      },
    },
  };

  it("marks fully-placed terms as met and untouched terms as unmet", () => {
    const plan = makePlan([
      slot("s1", 1239, ["cs115", "math115"]),
      slot("s2", 1241, ["cs136"]),
    ]);
    const audit = compileAudit(program, plan);
    expect(audit.byTerm).not.toBeNull();
    if (!audit.byTerm) return;
    expect(audit.byTerm["1A"].status).toBe("met");
    expect(audit.byTerm["1B"].status).toBe("met");
    expect(audit.byTerm["2A"].status).toBe("unmet");
    expect(audit.byTerm["4B"].status).toBe("unmet");
  });

  it("marks partially-placed terms as partial with the missing codes listed", () => {
    const plan = makePlan([slot("s1", 1239, ["cs115"])]);
    const audit = compileAudit(program, plan);
    expect(audit.byTerm).not.toBeNull();
    if (!audit.byTerm) return;
    const oneA = audit.byTerm["1A"];
    expect(oneA.status).toBe("partial");
    expect(oneA.missingCodes).toEqual(["math115"]);
    expect(oneA.satisfiers.map((s) => s.code)).toEqual(["cs115"]);
  });

  it("courses placed in a different term still satisfy the rule (the audit is course-centric, not term-centric)", () => {
    // se212 is required in 2A but the student placed it in 3A. Audit should
    // still mark the 2A requirement met. (Off-schedule placement is a soft
    // annotation handled at the UI layer, not an audit-status change.)
    const plan = makePlan([slot("s1", 1249, ["se212"])]); // 1249 = position 3A in a Fall 2023 start, but doesn't matter
    const audit = compileAudit(program, plan);
    expect(audit.byTerm).not.toBeNull();
    if (!audit.byTerm) return;
    expect(audit.byTerm["2A"].status).toBe("met");
    // The placement metadata reveals where it actually lives:
    expect(audit.byTerm["2A"].satisfiers[0].termId).toBe(1249);
  });
});

describe("compileAudit — pick with all-courses children (choice group)", () => {
  const rules: RuleNode = {
    kind: "pick",
    selectMin: 2,
    selectMax: 2,
    children: [
      { kind: "courses", courses: ["a1", "a2"] },
      { kind: "courses", courses: ["b1"] },
    ],
  };
  const program: Program = {
    kind: "flexible",
    name: "Toy Flex",
    asOf: "2026",
    rules,
  };

  it("unions option codes and counts distinct placements", () => {
    const plan = makePlan([slot("s1", 1239, ["a1", "b1"])]);
    const audit = compileAudit(program, plan);
    expect(audit.flexibleRoot).not.toBeNull();
    if (!audit.flexibleRoot) return;
    expect(audit.flexibleRoot.status).toBe("met");
    expect(audit.flexibleRoot.satisfiedCount).toBe(2);
  });

  it("is partial when some options are placed but selectMin is not reached", () => {
    const plan = makePlan([slot("s1", 1239, ["a1"])]);
    const audit = compileAudit(program, plan);
    expect(audit.flexibleRoot).not.toBeNull();
    if (!audit.flexibleRoot) return;
    expect(audit.flexibleRoot.status).toBe("partial");
    expect(audit.flexibleRoot.satisfiedCount).toBe(1);
  });

  it("is unmet when nothing in the pool is placed", () => {
    const plan = makePlan([]);
    const audit = compileAudit(program, plan);
    expect(audit.flexibleRoot).not.toBeNull();
    if (!audit.flexibleRoot) return;
    expect(audit.flexibleRoot.status).toBe("unmet");
    expect(audit.flexibleRoot.satisfiedCount).toBe(0);
  });
});

describe("compileAudit — pick selectMax", () => {
  it("marks a pick as overSatisfied when count > selectMax", () => {
    const rules: RuleNode = {
      kind: "pick",
      selectMin: 1,
      selectMax: 1,
      children: [{ kind: "courses", courses: ["opt1", "opt2"] }],
    };
    const program: Program = {
      kind: "flexible",
      name: "P",
      asOf: "2026",
      rules,
    };
    const plan = makePlan([slot("s1", 1239, ["opt1", "opt2"])]);
    const audit = compileAudit(program, plan);
    expect(audit.flexibleRoot).not.toBeNull();
    if (!audit.flexibleRoot) return;
    expect(audit.flexibleRoot.status).toBe("overSatisfied");
    expect(audit.flexibleRoot.satisfiedCount).toBe(2);
  });
});

describe("compileAudit — subjectPool with maxLevel", () => {
  it("excludes courses above the maxLevel cap", () => {
    const rules: RuleNode = {
      kind: "subjectPool",
      selectCount: 2,
      subjectCodes: ["MATH"],
      minLevel: 200,
      maxLevel: 300,
    };
    const program: Program = {
      kind: "flexible",
      name: "P",
      asOf: "2026",
      rules,
    };
    // math237 (200) and math337 (300) count; math405 (400) is above maxLevel.
    const plan = makePlan([
      slot("s1", 1239, ["math237", "math337", "math405"]),
    ]);
    const audit = compileAudit(program, plan);
    expect(audit.flexibleRoot).not.toBeNull();
    if (!audit.flexibleRoot) return;
    expect(audit.flexibleRoot.satisfiedCount).toBe(2);
    expect(audit.flexibleRoot.status).toBe("met");
  });
});

describe("compileAudit — no program", () => {
  it("returns an empty AuditRoot with placement populated when program is null", () => {
    const plan = makePlan([slot("s1", 1239, ["cs115", "math115"])]);
    const audit = compileAudit(null, plan);
    expect(audit.byTerm).toBeNull();
    expect(audit.flexibleRoot).toBeNull();
    expect(audit.specializationRoot).toBeNull();
    // Placement is still useful for the picker / future audits.
    expect(audit.placement.get("cs115")?.slotId).toBe("s1");
    expect(audit.placement.get("math115")?.termId).toBe(1239);
  });
});

describe("compileAudit — pick with mixed/nested children", () => {
  const rules: RuleNode = {
    kind: "pick",
    selectMin: 1,
    selectMax: 1,
    children: [
      {
        kind: "all",
        children: [{ kind: "courses", courses: ["a", "b"] }],
      },
      {
        kind: "courses",
        courses: ["c"],
      },
    ],
  };
  const program: Program = {
    kind: "flexible",
    name: "Toy Mixed",
    asOf: "2026",
    rules,
  };

  it("counts a nested 'all' as 1 only when fully met", () => {
    // Only 'a' placed — the all child is partial, doesn't count.
    let audit = compileAudit(program, makePlan([slot("s1", 1239, ["a"])]));
    expect(audit.flexibleRoot).not.toBeNull();
    if (!audit.flexibleRoot) return;
    expect(audit.flexibleRoot.status).toBe("partial");

    // Both 'a' and 'b' placed — the all child is met, count = 1 ≥ min.
    audit = compileAudit(program, makePlan([slot("s1", 1239, ["a", "b"])]));
    expect(audit.flexibleRoot).not.toBeNull();
    if (!audit.flexibleRoot) return;
    expect(audit.flexibleRoot.status).toBe("met");
  });
});

describe("compileAudit — subjectPool", () => {
  const rules: RuleNode = {
    kind: "subjectPool",
    selectCount: 2,
    subjectCodes: ["ANTH"],
    minLevel: 200,
  };
  const program: Program = {
    kind: "flexible",
    name: "Toy Pool",
    asOf: "2026",
    rules,
  };

  it("counts placed courses matching the subject and level filters", () => {
    const plan = makePlan([
      slot("s1", 1239, ["anth201", "anth210", "anth102"]),
    ]);
    const audit = compileAudit(program, plan);
    expect(audit.flexibleRoot).not.toBeNull();
    if (!audit.flexibleRoot) return;
    // anth102 is below the 200 level cutoff; only anth201 + anth210 count.
    expect(audit.flexibleRoot.satisfiedCount).toBe(2);
    expect(audit.flexibleRoot.status).toBe("met");
  });
});

describe("compileAudit — excluded courses", () => {
  const rules: RuleNode = {
    kind: "all",
    children: [
      { kind: "courses", courses: ["math115"] },
      { kind: "excluded", courses: ["math103"] },
    ],
  };
  const program: Program = {
    kind: "flexible",
    name: "Toy Excl",
    asOf: "2026",
    rules,
  };

  it("does not gate status but records violations", () => {
    const plan = makePlan([slot("s1", 1239, ["math115", "math103"])]);
    const audit = compileAudit(program, plan);
    expect(audit.flexibleRoot).not.toBeNull();
    if (!audit.flexibleRoot) return;
    expect(audit.flexibleRoot.status).toBe("met"); // math115 is the only requirement
    const exclChild = audit.flexibleRoot.children.find(
      (c) => c.ruleNode.kind === "excluded",
    );
    expect(exclChild?.excludedViolations?.map((v) => v.code)).toEqual([
      "math103",
    ]);
  });
});

describe("compileAudit — specialization", () => {
  it("compiles spec rules from the passed program object", () => {
    const program: Program = {
      kind: "flexible",
      name: "P",
      asOf: "2026",
      rules: {
        kind: "all",
        children: [{ kind: "courses", courses: ["base1"] }],
      },
      specializations: [
        {
          slug: "ai",
          name: "AI",
          kualiId: "x",
          rules: {
            kind: "all",
            children: [{ kind: "courses", courses: ["cs486"] }],
          },
        },
      ],
    };
    const plan = makePlan([slot("s1", 1239, ["base1", "cs486"])]);
    // "myprog" is not registered in the global PROGRAMS index — the spec must
    // resolve from the passed program object, not via getSpecialization.
    plan.programIds = ["myprog"];
    const audit = compileAudit(program, plan, "ai");
    expect(audit.specializationRoot).not.toBeNull();
    expect(audit.specializationRoot?.status).toBe("met");
    expect(audit.specializationRoot?.satisfiers.map((s) => s.code)).toEqual([
      "cs486",
    ]);
  });
});

describe("summarize", () => {
  it("counts courses leaves under all-context", () => {
    const program: Program = {
      kind: "flexible",
      name: "P",
      asOf: "2026",
      rules: {
        kind: "all",
        children: [{ kind: "courses", courses: ["a", "b", "c"] }],
      },
    };
    const plan = makePlan([slot("s1", 1239, ["a"])]);
    const audit = compileAudit(program, plan);
    expect(audit.flexibleRoot).not.toBeNull();
    if (!audit.flexibleRoot) return;
    expect(summarize(audit.flexibleRoot)).toEqual({
      needed: 3,
      satisfied: 1,
      excludedViolationCount: 0,
    });
  });

  it("counts a pick as selectMin requirements", () => {
    const program: Program = {
      kind: "flexible",
      name: "P",
      asOf: "2026",
      rules: {
        kind: "pick",
        selectMin: 3,
        selectMax: 3,
        children: [{ kind: "courses", courses: ["a", "b", "c", "d", "e"] }],
      },
    };
    const plan = makePlan([slot("s1", 1239, ["a", "b"])]);
    const audit = compileAudit(program, plan);
    expect(audit.flexibleRoot).not.toBeNull();
    if (!audit.flexibleRoot) return;
    expect(summarize(audit.flexibleRoot)).toEqual({
      needed: 3,
      satisfied: 2,
      excludedViolationCount: 0,
    });
  });

  it("does NOT downgrade status when an excluded violation is present (status stays met)", () => {
    // Behavior contract: excluded rules surface a count but never gate status.
    const program: Program = {
      kind: "flexible",
      name: "P",
      asOf: "2026",
      rules: {
        kind: "all",
        children: [
          { kind: "courses", courses: ["math115"] },
          { kind: "excluded", courses: ["math103"] },
        ],
      },
    };
    const plan = makePlan([slot("s1", 1239, ["math115", "math103"])]);
    const audit = compileAudit(program, plan);
    expect(audit.flexibleRoot).not.toBeNull();
    if (!audit.flexibleRoot) return;
    expect(audit.flexibleRoot.status).toBe("met");
  });

  it("rolls excludedViolationCount up through nested all/pick parents", () => {
    const program: Program = {
      kind: "flexible",
      name: "P",
      asOf: "2026",
      rules: {
        kind: "all",
        children: [
          { kind: "courses", courses: ["math115"] },
          {
            kind: "all",
            children: [
              { kind: "excluded", courses: ["math103", "math104"] },
              { kind: "excluded", courses: ["chem120"] },
            ],
          },
        ],
      },
    };
    // Place math115 (legit) + two excluded violations (math103, chem120).
    const plan = makePlan([
      slot("s1", 1239, ["math115", "math103", "chem120"]),
    ]);
    const audit = compileAudit(program, plan);
    expect(audit.flexibleRoot).not.toBeNull();
    if (!audit.flexibleRoot) return;
    expect(summarize(audit.flexibleRoot)).toEqual({
      needed: 1,
      satisfied: 1,
      excludedViolationCount: 2,
    });
    expect(audit.flexibleRoot.status).toBe("met");
  });
});

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

describe("compileAudit — legality overlay (met-but-flagged)", () => {
  const program: Program = {
    kind: "flexible",
    name: "Toy",
    asOf: "2026",
    rules: {
      kind: "all",
      children: [{ kind: "courses", courses: ["cs115", "cs350"] }],
    },
  };

  it("flags an illegally-placed satisfier without changing met status", () => {
    // Both required courses are placed → the requirement is met. But cs350 in
    // s2 has an unmet prereq (passed in via the legality set), so it's flagged.
    const plan = makePlan([
      slot("s1", 1239, ["cs115"]),
      slot("s2", 1241, ["cs350"]),
    ]);
    const legality = new Set(["s2::cs350"]);
    const audit = compileAudit(program, plan, null, legality);
    if (!audit.flexibleRoot) throw new Error("expected flexibleRoot");
    // Still met — legality is met-but-flagged, not status-changing.
    expect(audit.flexibleRoot.status).toBe("met");
    // The illegal satisfier is tagged and rolls up to the root `all` node.
    expect(audit.flexibleRoot.illegalSatisfiers?.map((p) => p.code)).toEqual([
      "cs350",
    ]);
  });

  it("adds no overlay when the legality set is empty", () => {
    const plan = makePlan([slot("s1", 1239, ["cs115", "cs350"])]);
    const audit = compileAudit(program, plan, null, new Set());
    expect(audit.flexibleRoot?.illegalSatisfiers).toBeUndefined();
  });
});
