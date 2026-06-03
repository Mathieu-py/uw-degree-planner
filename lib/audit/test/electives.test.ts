import { describe, expect, it } from "vitest";
import {
  classifyElective,
  deriveElectiveSections,
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

  it("flags unit-based rules and never fabricates a count", () => {
    const e: ElectiveCategory = {
      description:
        "Complete a minimum of 0.5 unit of BIOL, CHEM, HLTH, or KIN courses at the 200-level or above",
    };
    const s = classifyElective(e);
    expect(s.kind).toBe("browse");
    if (s.kind !== "browse") return;
    expect(s.unitBased).toBe(true);
    expect(s.eligibleCodes).toEqual([]);
  });

  it("flags an explicit unitRequirement as unit-based", () => {
    const e: ElectiveCategory = {
      description: "6.0 units of ANTH courses",
      unitRequirement: 6,
    };
    const s = classifyElective(e);
    expect(s.kind).toBe("browse");
    if (s.kind !== "browse") return;
    expect(s.unitBased).toBe(true);
  });

  it("does not treat a finite phrase without an approved list as draggable", () => {
    const e: ElectiveCategory = {
      description: "Complete 3 additional courses from the above lists",
    };
    expect(classifyElective(e).kind).toBe("browse");
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
