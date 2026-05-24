import { describe, expect, it } from "vitest";
import type { LocalPlan } from "../../plan/types";
import type { Program, RuleNode } from "../../programs";
import { compileAudit, summarize } from "../compile";
import { buildPlacementMap } from "../placement";

function makePlan(slots: LocalPlan["slots"]): LocalPlan {
  return {
    version: 1,
    programId: "test",
    specializationId: null,
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
    if (!audit.flexibleRoot) return;
    expect(audit.flexibleRoot.status).toBe("partial");
    expect(audit.flexibleRoot.satisfiedCount).toBe(1);
  });

  it("is unmet when nothing in the pool is placed", () => {
    const plan = makePlan([]);
    const audit = compileAudit(program, plan);
    if (!audit.flexibleRoot) return;
    expect(audit.flexibleRoot.status).toBe("unmet");
    expect(audit.flexibleRoot.satisfiedCount).toBe(0);
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
    if (!audit.flexibleRoot) return;
    expect(audit.flexibleRoot.status).toBe("partial");

    // Both 'a' and 'b' placed — the all child is met, count = 1 ≥ min.
    audit = compileAudit(program, makePlan([slot("s1", 1239, ["a", "b"])]));
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
    plan.programId = "myprog";
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
    if (!audit.flexibleRoot) return;
    expect(summarize(audit.flexibleRoot)).toEqual({ needed: 3, satisfied: 1 });
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
    if (!audit.flexibleRoot) return;
    expect(summarize(audit.flexibleRoot)).toEqual({ needed: 3, satisfied: 2 });
  });
});
