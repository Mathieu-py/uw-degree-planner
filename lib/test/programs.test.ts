import { describe, expect, it } from "vitest";
import {
  describeRule,
  FACULTIES,
  facultyLabel,
  getRequiredCourses,
  isTermLetter,
  type Program,
  programShortCode,
  programTermSpan,
  type RuleNode,
  requiredCoursesIn,
  splitProgramName,
  TERM_LETTERS,
  walkRule,
} from "../programs";
import {
  programIdentity,
  programIdsTermSpan,
  programShortNames,
} from "../programs/meta";
import {
  getProgramOptions,
  getSpecialization,
  PROGRAMS,
  programReferencedCodes,
} from "../programs/registry";

function hasAnyPick(node: RuleNode): boolean {
  let found = false;
  walkRule(node, (n) => {
    if (n.kind === "pick") found = true;
  });
  return found;
}

describe("programReferencedCodes", () => {
  it("includes a required course (MATH119) for Systems Design Engineering", () => {
    // The bug case: MATH119 is required by SYDE even though its prose
    // restriction names only ECE/SWE/Nano — so it must be 'referenced'.
    const codes = programReferencedCodes("systems-design-engineering");
    expect(codes.has("math119")).toBe(true);
  });

  it("supersets getRequiredCourses (also covers choice-group / elective codes)", () => {
    const prog = PROGRAMS["systems-design-engineering"];
    if (!prog) throw new Error("systems-design-engineering missing");
    const referenced = programReferencedCodes("systems-design-engineering");
    for (const code of getRequiredCourses(prog)) {
      expect(referenced.has(code.toLowerCase())).toBe(true);
    }
  });

  it("returns lowercase codes", () => {
    const codes = programReferencedCodes("systems-design-engineering");
    for (const c of codes) expect(c).toBe(c.toLowerCase());
  });

  it("returns an empty set for an unknown / missing program", () => {
    expect(programReferencedCodes(null).size).toBe(0);
    expect(programReferencedCodes("not-a-real-program").size).toBe(0);
  });

  it("memoizes — returns the same set reference for the same key", () => {
    const a = programReferencedCodes("systems-design-engineering");
    const b = programReferencedCodes("systems-design-engineering");
    expect(a).toBe(b);
  });
});

describe("term span (#105)", () => {
  it("programTermSpan reads numberOfTerms, defaulting to 8", () => {
    expect(programTermSpan(PROGRAMS["3g-anthropology"])).toBe(6);
    expect(programTermSpan(PROGRAMS["systems-design-engineering"])).toBe(8);
    const noField = {
      ...PROGRAMS["3g-anthropology"],
      numberOfTerms: undefined,
    };
    expect(programTermSpan(noField)).toBe(8);
  });

  it("programIdsTermSpan takes the max across programs, 8 when empty/unknown", () => {
    expect(programIdsTermSpan([])).toBe(8);
    expect(programIdsTermSpan(["not-a-real-program"])).toBe(8);
    expect(programIdsTermSpan(["3g-anthropology"])).toBe(6);
    // A 3-year + 4-year double major runs as long as the longer leg.
    expect(
      programIdsTermSpan(["3g-anthropology", "systems-design-engineering"]),
    ).toBe(8);
  });

  it("every Three-Year General program is 6 terms; honours/four-year are 8", () => {
    for (const [id, prog] of Object.entries(PROGRAMS)) {
      const isThreeYearSingle =
        /three-year/i.test(prog.name) && !/double degree/i.test(prog.name);
      // An Honours / Four-Year clause is the full 8 even when a joint honours'
      // unit total is only its half of the degree (regression: jh-physics).
      const isFullDegree =
        /honours|four-year/i.test(prog.name) && !/three-year/i.test(prog.name);
      if (isThreeYearSingle) {
        expect(prog.numberOfTerms, `${id} should span 6 terms`).toBe(6);
      } else if (isFullDegree) {
        expect(prog.numberOfTerms, `${id} should span 8 terms`).toBe(8);
      }
    }
    expect(PROGRAMS["jh-physics"].numberOfTerms).toBe(8);
    expect(PROGRAMS["systems-design-engineering"].numberOfTerms).toBe(8);
  });
});

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

  it("every program is stamped with a known faculty (for the program picker)", () => {
    // The picker filters + groups by faculty, so a missing/unknown faculty
    // would leave a program unreachable from any tab but "All".
    for (const [id, prog] of Object.entries(PROGRAMS)) {
      expect(prog.faculty, `${id} should have a faculty`).toBeDefined();
      expect(
        FACULTIES,
        `${id}.faculty "${prog.faculty}" should be a known faculty`,
      ).toContain(prog.faculty);
    }
  });
});

describe("getProgramOptions — faculty", () => {
  it("carries each program's faculty through to the option digest", () => {
    const options = getProgramOptions();
    expect(options.length).toBe(Object.keys(PROGRAMS).length);
    for (const opt of options) {
      expect(opt.faculty).toBe(PROGRAMS[opt.id].faculty);
    }
  });

  it("every faculty has a title-case label and appears in the data", () => {
    const present = new Set(getProgramOptions().map((o) => o.faculty));
    for (const faculty of FACULTIES) {
      expect(facultyLabel(faculty)).toBe(
        faculty[0].toUpperCase() + faculty.slice(1),
      );
      expect(present, `${faculty} should be present in the catalog`).toContain(
        faculty,
      );
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

describe("getSpecialization", () => {
  const parent = "3g-english-literature-and-rhetoric";
  const spec = "engl-communication-design";

  it("returns the spec for a slug that belongs to the program", () => {
    expect(getSpecialization(parent, spec)?.slug).toBe(spec);
  });

  it("returns null for a slug from a different program", () => {
    expect(getSpecialization("systems-design-engineering", spec)).toBeNull();
  });

  it("returns null for an unknown spec slug under a known program", () => {
    expect(getSpecialization(parent, "totally-fake-spec")).toBeNull();
  });

  it("returns null when the program is unknown", () => {
    expect(getSpecialization("not-a-program", spec)).toBeNull();
  });
});

describe("programIdentity", () => {
  it("derives engineering faculty + short name + alias for SYDE", () => {
    const id = programIdentity("systems-design-engineering");
    expect(id?.faculty).toBe("engineering");
    expect(id?.names).toContain("systems design engineering");
    expect(id?.names).toContain("syde");
  });

  it("maps Bachelor of Computer Science to the mathematics faculty", () => {
    const id = programIdentity("h-computer-science-bcs");
    expect(id?.faculty).toBe("mathematics");
    expect(id?.names).toEqual(
      expect.arrayContaining(["computer science", "cs"]),
    );
  });

  it("derives arts faculty for a Bachelor of Arts program", () => {
    expect(programIdentity("3g-anthropology")?.faculty).toBe("arts");
  });

  it("leaves faculty null when the degree type is ambiguous", () => {
    // "Bachelor of Medical Sciences" maps to no faculty in DEGREE_FACULTY.
    expect(programIdentity("medical-sciences")?.faculty).toBeNull();
  });

  it("returns null for an unknown or empty program id", () => {
    expect(programIdentity("not-a-program")).toBeNull();
    expect(programIdentity(null)).toBeNull();
    expect(programIdentity(undefined)).toBeNull();
  });
});

describe("programShortNames", () => {
  it("includes registry short names and curated aliases", () => {
    const names = programShortNames();
    expect(names.has("systems design engineering")).toBe(true);
    expect(names.has("computer science")).toBe(true);
    expect(names.has("syde")).toBe(true);
    expect(names.has("cs")).toBe(true);
  });
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
      "Complete 2 additional courses at the 300-400-level from: ACTSC, AMATH, CS; excluding courses cross-listed with a CO course",
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

describe("splitProgramName", () => {
  it("splits a simple 'Title (Degree)' name", () => {
    expect(splitProgramName("Applied Mathematics (Joint Honours)")).toEqual({
      title: "Applied Mathematics",
      degree: "Joint Honours",
    });
  });

  it("keeps nested parentheses inside the degree (double-degree names)", () => {
    expect(
      splitProgramName(
        "Computer Science (Bachelor of Computer Science (Co-op) - Joint Honours)",
      ),
    ).toEqual({
      title: "Computer Science",
      degree: "Bachelor of Computer Science (Co-op) - Joint Honours",
    });
  });

  it("returns just the title when there is no parenthetical", () => {
    expect(splitProgramName("Architectural Studies")).toEqual({
      title: "Architectural Studies",
    });
  });
});

describe("programShortCode", () => {
  const make = (
    name: string,
    extra: Partial<Program> = {},
    rules: RuleNode = { kind: "all", children: [] },
  ): Program =>
    ({
      kind: "flexible",
      name,
      asOf: "2026-05-22",
      rules,
      ...extra,
    }) as Program;

  const allOf = (...courses: string[]): RuleNode => ({
    kind: "all",
    children: [{ kind: "courses", courses }],
  });

  it("returns the official subjectCode whole (not truncated to 4 chars)", () => {
    const prog = make(
      "Applied Mathematics (Bachelor of Mathematics - Honours)",
      {
        subjectCode: "AMATH",
      },
    );
    expect(programShortCode(prog)).toBe("AMATH");
  });

  it("prefers a curated override over the stamped subjectCode", () => {
    // Defensive: even if a wrong code were stamped, the override wins.
    const prog = make("Computer Engineering", { subjectCode: "WRONG" });
    expect(programShortCode(prog)).toBe("ECE");
  });

  it("returns a double-degree override", () => {
    const prog = make("Business Administration and Mathematics Double Degree");
    expect(programShortCode(prog)).toBe("BMATH");
  });

  it("falls back to the modal subject prefix of required courses", () => {
    const prog = make(
      "Applied Mathematics",
      {},
      allOf("amath231", "amath353", "amath242", "cs371"),
    );
    expect(programShortCode(prog)).toBe("AMATH");
  });

  it("falls back to initials when there are no required courses", () => {
    const prog = make("Some New Program");
    expect(programShortCode(prog)).toBe("SNP");
  });
});
