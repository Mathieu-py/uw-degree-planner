import { describe, expect, it } from "vitest";
import {
  classifyElective,
  consolidateElectives,
  deriveElectiveSections,
  subjectPoolEligible,
} from "@/lib/audit/electives";
import { type ElectiveCategory, PROGRAMS, type Program } from "@/lib/programs";

describe("classifyElective", () => {
  it("treats 'Complete N of the following' with an approved list as finite/draggable", () => {
    const e: ElectiveCategory = {
      description:
        "Complete 2 of the following: ARCH463 - Integrated Environmental Systems (0.50)CIVE413 - Structural Steel Design (0.50)",
      approvedCourses: ["arch463", "cive413", "cive414"],
    };
    const s = classifyElective(e);
    expect(s.kind).toBe("finite");
    if (s.kind !== "finite") return;
    expect(s.need).toBe(2);
    expect(s.title).toBe("Complete 2 of the following");
    expect(s.options).toEqual(["arch463", "cive413", "cive414"]);
  });

  it("treats a bare reference list as a browse section", () => {
    const e: ElectiveCategory = {
      description: "Natural Science List",
      approvedCourses: ["biol130", "biol150"],
    };
    const s = classifyElective(e);
    expect(s.kind).toBe("browse");
    if (s.kind !== "browse") return;
    expect(s.title).toBe("Natural Science List");
    expect(s.eligibleCodes).toEqual(["biol130", "biol150"]);
    expect(s.unitBased).toBe(false);
  });

  it("treats cross-list references as browse, not finite", () => {
    const e: ElectiveCategory = {
      description:
        "Complete 2 additional courses from List 1 or List 2. See Additional Constraints.",
      approvedCourses: ["che500", "che514"],
    };
    expect(classifyElective(e).kind).toBe("browse");
  });

  it("parses a unit-based subject+level rule into a trackable subjectPool", () => {
    const e: ElectiveCategory = {
      description:
        "Complete a minimum of 0.5 unit of BIOL, CHEM, HLTH, or KIN courses at the 200-level or above",
    };
    const s = classifyElective(e);
    expect(s.kind).toBe("subjectPool");
    if (s.kind !== "subjectPool") return;
    expect(s.subjects).toEqual(["biol", "chem", "hlth", "kin"]);
    expect(s.minLevel).toBe(200);
    expect(s.maxLevel).toBeUndefined();
    expect(s.need).toBe(1); // 0.5 unit ÷ 0.5
  });

  it("parses a level-less unit subject rule (need = units ÷ 0.5)", () => {
    const e: ElectiveCategory = {
      description: "6.0 units of ANTH courses",
      unitRequirement: 6,
    };
    const s = classifyElective(e);
    expect(s.kind).toBe("subjectPool");
    if (s.kind !== "subjectPool") return;
    expect(s.subjects).toEqual(["anth"]);
    expect(s.need).toBe(12);
    expect(s.minLevel).toBeUndefined();
  });

  it("does not treat a finite phrase without an approved list as draggable", () => {
    const e: ElectiveCategory = {
      description: "Complete 3 additional courses from the above lists",
    };
    expect(classifyElective(e).kind).toBe("browse");
  });
});

describe("subjectPoolEligible", () => {
  const s = classifyElective({
    description:
      "Complete a minimum of 0.5 unit of BIOL, CHEM, HLTH, or KIN courses at the 200-level or above",
  });

  it("matches by subject prefix and respects the level bound", () => {
    if (s.kind !== "subjectPool") throw new Error("expected subjectPool");
    expect(subjectPoolEligible("biol250", s)).toBe(true);
    expect(subjectPoolEligible("kin486", s)).toBe(true);
    expect(subjectPoolEligible("biol150", s)).toBe(false); // below 200
    expect(subjectPoolEligible("math250", s)).toBe(false); // wrong subject
  });
});

describe("deriveElectiveSections", () => {
  it("disambiguates repeated titles with a trailing index", () => {
    const program = {
      kind: "engineering",
      name: "Test",
      asOf: "2026-05-23",
      terms: {},
      electives: [
        {
          description: "Complete 1 of the following: A",
          approvedCourses: ["a"],
        },
        {
          description: "Complete 1 of the following: B",
          approvedCourses: ["b"],
        },
        {
          description: "Complete 1 of the following: C",
          approvedCourses: ["c"],
        },
      ],
    } as unknown as Program;

    const titles = deriveElectiveSections(program).map((s) => s.title);
    expect(titles).toEqual([
      "Complete 1 of the following",
      "Complete 1 of the following (2)",
      "Complete 1 of the following (3)",
    ]);
  });

  it("returns an empty list when a program has no electives", () => {
    const program = {
      kind: "flexible",
      name: "Test",
      asOf: "2026-05-23",
      rules: { kind: "all", children: [] },
    } as unknown as Program;
    expect(deriveElectiveSections(program)).toEqual([]);
  });
});

describe("consolidateElectives", () => {
  it("drops sub-lists subsumed by an aggregate that unions them (BME shape)", () => {
    const cats: ElectiveCategory[] = [
      {
        description: "Complete 1 of the following: A",
        approvedCourses: ["c1", "c2"],
      },
      {
        description: "Complete 1 of the following: B",
        approvedCourses: ["c3"],
      },
      {
        description: "Technical Electives List",
        requiredCount: 3,
        approvedCourses: ["c1", "c2", "c3"],
      },
    ];
    const out = consolidateElectives(cats);
    expect(out).toHaveLength(1);
    expect(out[0].description).toBe("Technical Electives List");
  });

  it("keeps lists that merely overlap but aren't an exact union", () => {
    const cats: ElectiveCategory[] = [
      { description: "List A", approvedCourses: ["c1", "c2"] },
      { description: "List B", approvedCourses: ["c3"] },
      // aggregate has an extra code (c4) → not exactly A ∪ B, so keep all three
      { description: "Aggregate", approvedCourses: ["c1", "c2", "c3", "c4"] },
    ];
    expect(consolidateElectives(cats)).toHaveLength(3);
  });

  it("leaves distinct sibling lists untouched", () => {
    const cats: ElectiveCategory[] = [
      { description: "Complete 1 of the following: A", approvedCourses: ["a"] },
      { description: "Complete 1 of the following: B", approvedCourses: ["b"] },
      { description: "Complete 1 of the following: C", approvedCourses: ["c"] },
    ];
    expect(consolidateElectives(cats)).toHaveLength(3);
  });

  it("collapses Biomedical Engineering to a single technical-electives row", () => {
    const titles = deriveElectiveSections(
      PROGRAMS["biomedical-engineering"],
    ).map((s) => s.title);
    // No more "(2)"/"(3)" duplicates of "Complete 1 of the following".
    expect(
      titles.filter((t) => /^Complete 1 of the following/.test(t)),
    ).toEqual([]);
    expect(titles).toContain("Technical Electives List");
    // The courseless "Complete 3 additional courses from the above lists…"
    // connective orphan is gone too — it pointed at the now-collapsed sub-lists.
    expect(titles.filter((t) => /from the above lists/i.test(t))).toEqual([]);
  });

  it("drops a courseless cross-list connective orphan when an aggregate is present", () => {
    const cats: ElectiveCategory[] = [
      {
        description: "Complete 1 of the following: A",
        approvedCourses: ["c1", "c2"],
      },
      {
        description: "Complete 1 of the following: B",
        approvedCourses: ["c3"],
      },
      {
        description: "Technical Electives List",
        requiredCount: 3,
        approvedCourses: ["c1", "c2", "c3"],
      },
      {
        description:
          "Complete 3 additional courses from the above lists, including no more than 2 from List 3.",
        requiredCount: 3,
      },
    ];
    const out = consolidateElectives(cats);
    expect(out.map((e) => e.description)).toEqual(["Technical Electives List"]);
  });

  it("keeps a cross-list connective orphan when no aggregate fired", () => {
    // No aggregate unions these two distinct lists, so consolidation does not
    // fire — leave the orphan visible rather than hide an unrepresented rule.
    const cats: ElectiveCategory[] = [
      { description: "Complete 1 of the following: A", approvedCourses: ["a"] },
      { description: "Complete 1 of the following: B", approvedCourses: ["b"] },
      {
        description: "Complete 2 additional courses from the above lists.",
        requiredCount: 2,
      },
    ];
    expect(consolidateElectives(cats)).toHaveLength(3);
  });
});

describe("deriveElectiveSections — every real program", () => {
  // Run the classifier over the whole catalog to catch data shapes the regex
  // mishandles (e.g. a giant embedded course list leaking into a title).
  it("produces clean titles and well-formed finite sections", () => {
    for (const [programId, program] of Object.entries(PROGRAMS)) {
      for (const section of deriveElectiveSections(program)) {
        expect(
          section.title.length,
          `${programId}: elective title too long → ${section.title.slice(0, 60)}`,
        ).toBeLessThanOrEqual(95);
        expect(
          section.title.trim().length,
          `${programId}: empty elective title`,
        ).toBeGreaterThan(0);
        if (section.kind === "finite") {
          expect(section.need, `${programId}: finite need`).toBeGreaterThan(0);
          expect(
            section.options.length,
            `${programId}: finite section with no options`,
          ).toBeGreaterThan(0);
        }
      }
    }
  });
});
