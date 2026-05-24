import { describe, expect, it } from "vitest";
import {
  describeRule,
  getRequiredCourses,
  getSpecialization,
  getSubjectPools,
  isKnownProgram,
  isKnownSpecialization,
  isTermLetter,
  PROGRAMS,
  type Program,
  type RuleNode,
  requiredCoursesIn,
  TERM_LETTERS,
  walkRule,
} from "../programs";

function hasAnyPick(node: RuleNode): boolean {
  let found = false;
  walkRule(node, (n) => {
    if (n.kind === "pick") found = true;
  });
  return found;
}

describe("programs.json schema integrity", () => {
  it("every entry has a kind field", () => {
    for (const [id, prog] of Object.entries(PROGRAMS)) {
      expect(
        prog.kind === "engineering" || prog.kind === "flexible",
        `${id}.kind should be "engineering" or "flexible"`,
      ).toBe(true);
    }
  });

  it("engineering programs have all 8 term rule trees", () => {
    const ruleNodeKinds: ReadonlyArray<RuleNode["kind"]> = [
      "all",
      "pick",
      "subjectPool",
      "courses",
      "excluded",
    ];
    for (const [id, prog] of Object.entries(PROGRAMS)) {
      if (prog.kind !== "engineering") continue;
      for (const term of TERM_LETTERS) {
        expect(
          ruleNodeKinds,
          `${id}.terms.${term}.kind should be a valid RuleNode kind`,
        ).toContain(prog.terms[term]?.kind);
      }
    }
  });

  it("every program has at least some captured data (required courses or pick nodes)", () => {
    // A program with empty required courses but populated pick nodes is
    // still valid — see e.g. 3g-mathematics, which is entirely choice-driven.
    // The scraper drops only programs that yield neither.
    for (const [id, prog] of Object.entries(PROGRAMS)) {
      const hasRequired = getRequiredCourses(prog).length > 0;
      const hasChoices =
        prog.kind === "engineering"
          ? TERM_LETTERS.some((t) => hasAnyPick(prog.terms[t]))
          : hasAnyPick(prog.rules);
      expect(
        hasRequired || hasChoices,
        `${id} should have required courses or pick nodes`,
      ).toBe(true);
    }
  });
});

describe("getRequiredCourses", () => {
  it("returns union of terms for engineering", () => {
    const syde = PROGRAMS["systems-design-engineering"];
    if (syde.kind !== "engineering")
      throw new Error("SYDE should be engineering");
    const required = getRequiredCourses(syde);
    expect(required).toContain("syde101");
    expect(required).toEqual([...required].sort());
    expect(new Set(required).size).toBe(required.length);
  });
});

describe("isTermLetter", () => {
  it("accepts the 8 standard term letters", () => {
    for (const t of TERM_LETTERS) expect(isTermLetter(t)).toBe(true);
  });

  it("rejects unknown and malformed inputs", () => {
    expect(isTermLetter("5A")).toBe(false);
    expect(isTermLetter("1a")).toBe(false);
    expect(isTermLetter("")).toBe(false);
    expect(isTermLetter(null)).toBe(false);
    expect(isTermLetter(undefined)).toBe(false);
  });
});

describe("isKnownProgram", () => {
  it("accepts well-known engineering program slugs", () => {
    for (const id of [
      "systems-design-engineering",
      "electrical-engineering",
      "software-engineering",
      "mechatronics-engineering",
      "architectural-studies",
      "medical-sciences",
    ]) {
      expect(isKnownProgram(id)).toBe(true);
    }
  });

  it("rejects unknown ids", () => {
    expect(isKnownProgram("phys")).toBe(false);
    expect(isKnownProgram("SYSTEMS-DESIGN-ENGINEERING")).toBe(false);
  });
});

describe("isKnownSpecialization / getSpecialization", () => {
  const parent = "3g-english-literature-and-rhetoric";
  const spec = "engl-communication-design";

  it("accepts a slug that belongs to the program", () => {
    expect(isKnownSpecialization(parent, spec)).toBe(true);
    expect(getSpecialization(parent, spec)?.slug).toBe(spec);
  });

  it("rejects a slug from a different program", () => {
    expect(isKnownSpecialization("systems-design-engineering", spec)).toBe(
      false,
    );
    expect(getSpecialization("systems-design-engineering", spec)).toBeNull();
  });

  it("rejects an unknown spec slug under a known program", () => {
    expect(isKnownSpecialization(parent, "totally-fake-spec")).toBe(false);
    expect(getSpecialization(parent, "totally-fake-spec")).toBeNull();
  });

  it("rejects all specs when the program is unknown", () => {
    expect(isKnownSpecialization("not-a-program", spec)).toBe(false);
  });
});

const flexible = (rules: RuleNode): Program => ({
  kind: "flexible",
  name: "test",
  asOf: "2026-05-22",
  rules,
});

describe("requiredCoursesIn — functionally-mandatory pick promotion", () => {
  it("promotes pick(1,1) over a single one-course leaf to required", () => {
    const node: RuleNode = {
      kind: "pick",
      selectMin: 1,
      selectMax: 1,
      children: [{ kind: "courses", courses: ["cs100"] }],
    };
    expect(requiredCoursesIn(node)).toEqual(["cs100"]);
  });

  it("does NOT promote pick(1,1) when the leaf carries multiple options", () => {
    const node: RuleNode = {
      kind: "pick",
      selectMin: 1,
      selectMax: 1,
      children: [{ kind: "courses", courses: ["cs115", "cs135"] }],
    };
    expect(requiredCoursesIn(node)).toEqual([]);
  });

  it("does NOT promote pick(2,2) when total unique options exceed selectMin", () => {
    const node: RuleNode = {
      kind: "pick",
      selectMin: 2,
      selectMax: 2,
      children: [{ kind: "courses", courses: ["a100", "b100", "c100"] }],
    };
    expect(requiredCoursesIn(node)).toEqual([]);
  });

  it("promotes pick(N,N) when total unique options exactly equal selectMin across split leaves", () => {
    const node: RuleNode = {
      kind: "pick",
      selectMin: 3,
      selectMax: 3,
      children: [
        { kind: "courses", courses: ["x100", "y100"] },
        { kind: "courses", courses: ["z100"] },
      ],
    };
    expect(requiredCoursesIn(node)).toEqual(["x100", "y100", "z100"]);
  });

  it("does NOT promote pick(1,1) when a non-courses child is present", () => {
    const node: RuleNode = {
      kind: "pick",
      selectMin: 1,
      selectMax: 1,
      children: [
        { kind: "courses", courses: ["cs100"] },
        { kind: "pick", children: [{ kind: "courses", courses: ["cs101"] }] },
      ],
    };
    expect(requiredCoursesIn(node)).toEqual([]);
  });

  it("does NOT promote a Choose-any pick (selectMin undefined)", () => {
    const node: RuleNode = {
      kind: "pick",
      children: [{ kind: "courses", courses: ["cs100"] }],
    };
    expect(requiredCoursesIn(node)).toEqual([]);
  });
});

describe("getSubjectPools", () => {
  it("returns every subjectPool node in DFS order", () => {
    const program = flexible({
      kind: "all",
      children: [
        {
          kind: "subjectPool",
          description: "Complete 2 additional STAT",
          selectCount: 2,
          subjectCodes: ["STAT"],
          minLevel: 300,
        },
        {
          kind: "pick",
          selectMin: 1,
          selectMax: 1,
          children: [{ kind: "courses", courses: ["cs100"] }],
        },
        {
          kind: "subjectPool",
          description: "Complete 1 additional PMATH",
          selectCount: 1,
          subjectCodes: ["PMATH"],
        },
      ],
    });
    const pools = getSubjectPools(program);
    expect(pools).toHaveLength(2);
    expect(pools.map((p) => p.subjectCodes)).toEqual([["STAT"], ["PMATH"]]);
    expect(pools[0].minLevel).toBe(300);
  });

  it("walks into nested pick/all children", () => {
    const program = flexible({
      kind: "all",
      children: [
        {
          kind: "pick",
          selectMin: 1,
          selectMax: 1,
          children: [
            {
              kind: "subjectPool",
              description: "nested",
              selectCount: 1,
              subjectCodes: ["CS"],
            },
          ],
        },
      ],
    });
    expect(getSubjectPools(program)).toHaveLength(1);
  });

  it("returns [] when no subjectPool nodes are present", () => {
    const program = flexible({ kind: "courses", courses: ["cs100"] });
    expect(getSubjectPools(program)).toEqual([]);
  });
});

describe("describeRule", () => {
  it("returns undefined for leaf `courses` nodes", () => {
    expect(
      describeRule({ kind: "courses", courses: ["cs115"] }),
    ).toBeUndefined();
  });

  it("derives 'Complete all of the following' for `all`", () => {
    expect(describeRule({ kind: "all", children: [] })).toBe(
      "Complete all of the following",
    );
  });

  it("derives the excluded prose for `excluded`", () => {
    expect(describeRule({ kind: "excluded", courses: ["chem266"] })).toBe(
      "The following cannot be used towards this academic plan",
    );
  });

  it("derives 'Complete N of the following' for pick(N,N) over a single courses leaf", () => {
    const node: RuleNode = {
      kind: "pick",
      selectMin: 2,
      selectMax: 2,
      children: [{ kind: "courses", courses: ["cs115", "cs135"] }],
    };
    expect(describeRule(node)).toBe("Complete 2 of the following");
  });

  it("derives the metaParent phrasing for pick(N,N) whose children are themselves rules", () => {
    const node: RuleNode = {
      kind: "pick",
      selectMin: 3,
      selectMax: 3,
      children: [
        { kind: "pick", children: [{ kind: "courses", courses: ["cs462"] }] },
        { kind: "pick", children: [{ kind: "courses", courses: ["cs466"] }] },
      ],
    };
    expect(describeRule(node)).toBe(
      "Complete 3 courses from the following choices",
    );
  });

  it("singularizes 'course' when the metaParent count is 1", () => {
    const node: RuleNode = {
      kind: "pick",
      selectMin: 1,
      selectMax: 1,
      children: [
        { kind: "pick", children: [{ kind: "courses", courses: ["cs462"] }] },
        { kind: "pick", children: [{ kind: "courses", courses: ["cs466"] }] },
      ],
    };
    expect(describeRule(node)).toBe(
      "Complete 1 course from the following choices",
    );
  });

  it("derives 'Choose any of the following' for an unbounded pick", () => {
    const node: RuleNode = {
      kind: "pick",
      children: [{ kind: "courses", courses: ["cs462"] }],
    };
    expect(describeRule(node)).toBe("Choose any of the following");
  });

  it("derives 'Complete no more than N from the following' for pick with only selectMax", () => {
    const node: RuleNode = {
      kind: "pick",
      selectMax: 1,
      children: [{ kind: "courses", courses: ["cs100", "cs101"] }],
    };
    expect(describeRule(node)).toBe(
      "Complete no more than 1 from the following",
    );
  });

  it("derives 'Complete at least N of the following' for pick with only selectMin over a leaf", () => {
    const node: RuleNode = {
      kind: "pick",
      selectMin: 2,
      children: [{ kind: "courses", courses: ["cs100", "cs101", "cs102"] }],
    };
    expect(describeRule(node)).toBe("Complete at least 2 of the following");
  });

  it("derives the metaParent 'Complete at least N courses from the following choices' for pick with only selectMin", () => {
    const node: RuleNode = {
      kind: "pick",
      selectMin: 2,
      children: [
        { kind: "pick", children: [{ kind: "courses", courses: ["cs462"] }] },
        { kind: "pick", children: [{ kind: "courses", courses: ["cs466"] }] },
      ],
    };
    expect(describeRule(node)).toBe(
      "Complete at least 2 courses from the following choices",
    );
  });

  it("derives the ranged 'Complete between N and M of the following' for pick over a leaf", () => {
    const node: RuleNode = {
      kind: "pick",
      selectMin: 2,
      selectMax: 4,
      children: [
        { kind: "courses", courses: ["cs100", "cs101", "cs102", "cs103"] },
      ],
    };
    expect(describeRule(node)).toBe(
      "Complete between 2 and 4 of the following",
    );
  });

  it("derives the metaParent ranged phrasing for pick with unequal selectMin/selectMax", () => {
    const node: RuleNode = {
      kind: "pick",
      selectMin: 1,
      selectMax: 3,
      children: [
        { kind: "pick", children: [{ kind: "courses", courses: ["cs462"] }] },
        { kind: "pick", children: [{ kind: "courses", courses: ["cs466"] }] },
      ],
    };
    expect(describeRule(node)).toBe(
      "Complete between 1 and 3 courses from the following choices",
    );
  });

  it("honors a stored `description` override (non-standard wrapper prose)", () => {
    expect(
      describeRule({
        kind: "all",
        description: "Take these before 3A term",
        children: [],
      }),
    ).toBe("Take these before 3A term");
  });

  it("reconstructs subjectPool prose for the single-subject + level case", () => {
    expect(
      describeRule({
        kind: "subjectPool",
        selectCount: 2,
        subjectCodes: ["STAT"],
        minLevel: 300,
      }),
    ).toBe("Complete 2 additional STAT courses at the 300-level");
  });

  it("reconstructs subjectPool prose for the multi-subject + level-range + exclusion case", () => {
    expect(
      describeRule({
        kind: "subjectPool",
        selectCount: 2,
        subjectCodes: ["ACTSC", "AMATH", "CS"],
        minLevel: 300,
        maxLevel: 400,
        exclusions: ["excluding courses cross-listed with a CO course"],
      }),
    ).toBe(
      "Complete 2 additional courses at the 300- or 400-level from: ACTSC, AMATH, CS; excluding courses cross-listed with a CO course",
    );
  });

  it("reconstructs subjectPool prose for the multi-subject + no-level case", () => {
    expect(
      describeRule({
        kind: "subjectPool",
        selectCount: 3,
        subjectCodes: ["ACTSC", "AMATH"],
      }),
    ).toBe("Complete 3 additional courses from: ACTSC, AMATH");
  });

  it("singularizes 'course' when subjectPool selectCount is 1", () => {
    expect(
      describeRule({
        kind: "subjectPool",
        selectCount: 1,
        subjectCodes: ["EARTH"],
        minLevel: 300,
      }),
    ).toBe("Complete 1 additional EARTH course at the 300-level");
  });
});
