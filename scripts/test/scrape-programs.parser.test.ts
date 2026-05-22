import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildConflictCounts,
  buildProgramSlug,
  normalizeCourseCode,
  parseElectives,
  parseProgramRequirements,
} from "../scrape-programs.parser";

const fixture = (name: string) =>
  readFileSync(path.join(__dirname, "fixtures", `${name}.html`), "utf-8");

describe("parseProgramRequirements — empty input", () => {
  it("returns kind:'empty' when no fields are present", () => {
    const r = parseProgramRequirements({});
    expect(r.kind).toBe("empty");
    expect(r.warnings).toEqual([]);
  });

  it("returns kind:'empty' when requirements HTML has no <section> elements", () => {
    const r = parseProgramRequirements(
      { requirements: "<div>No sections here</div>" },
      "orphan",
    );
    expect(r.kind).toBe("empty");
  });

  it("returns kind:'empty' for whitespace-only fields", () => {
    const r = parseProgramRequirements({
      requiredCoursesTermByTerm: "   \n   ",
      requirements: "",
      courseRequirementsNoUnits: "  ",
    });
    expect(r.kind).toBe("empty");
  });
});

describe("parseProgramRequirements — engineering (SYDE fixture)", () => {
  const r = parseProgramRequirements(
    { requiredCoursesTermByTerm: fixture("syde") },
    "syde",
  );

  it("returns kind:'engineering' when requiredCoursesTermByTerm is present", () => {
    expect(r.kind).toBe("engineering");
  });

  it("extracts 1A required courses", () => {
    if (r.kind !== "engineering") throw new Error("expected engineering");
    expect(r.terms["1A"]).toEqual([
      "math115",
      "math117",
      "syde101",
      "syde121",
      "syde151",
      "syde161",
    ]);
  });

  it("extracts 1B required courses including syde101l (with letter suffix)", () => {
    if (r.kind !== "engineering") throw new Error("expected engineering");
    expect(r.terms["1B"]).toContain("syde101l");
    expect(r.terms["1B"]).toContain("math119");
  });

  it("populates all 8 terms (Engineering programs have term-by-term data)", () => {
    if (r.kind !== "engineering") throw new Error("expected engineering");
    for (const t of ["1A", "1B", "2A", "2B", "3A", "3B", "4A", "4B"] as const) {
      expect(r.terms[t].length).toBeGreaterThan(0);
    }
  });

  it("does not include elective-slot text as course codes", () => {
    if (r.kind !== "engineering") throw new Error("expected engineering");
    const all = Object.values(r.terms).flat();
    for (const code of all) {
      expect(code).toMatch(/^[a-z]{2,8}\d{3}[a-z]?$/);
    }
  });

  it("emits no warnings for SYDE (all rules are recognized)", () => {
    expect(r.warnings).toEqual([]);
  });
});

describe("parseProgramRequirements — engineering (Computer Engineering fixture)", () => {
  const r = parseProgramRequirements(
    { requiredCoursesTermByTerm: fixture("cpe") },
    "cpe",
  );

  it("extracts ECE 1A courses", () => {
    if (r.kind !== "engineering") throw new Error("expected engineering");
    expect(r.terms["1A"]).toContain("ece105");
    expect(r.terms["1A"]).toContain("ece150");
  });

  it("output is sorted and deduped per term", () => {
    if (r.kind !== "engineering") throw new Error("expected engineering");
    for (const codes of Object.values(r.terms)) {
      const sorted = [...codes].sort();
      expect(codes).toEqual(sorted);
      expect(new Set(codes).size).toBe(codes.length);
    }
  });
});

describe("parseProgramRequirements — engineering 'Complete N of' → ChoiceGroup", () => {
  it("captures 'Complete 1 of the following' as a ChoiceGroup, not a warning", () => {
    const html = `
      <section>
        <header><h2 data-testid="grouping-label"><span>1A Term</span></h2></header>
        <div>
          <div data-test="ruleView-A-result">
            Complete all the following:
            <a href="#">MATH115</a>
          </div>
          <div data-test="ruleView-B-result">
            Complete 1 of the following:
            <a href="#">CS115</a>
            <a href="#">CS135</a>
            <a href="#">CS145</a>
          </div>
        </div>
      </section>`;
    const r = parseProgramRequirements(
      { requiredCoursesTermByTerm: html },
      "test",
    );
    if (r.kind !== "engineering") throw new Error("expected engineering");
    expect(r.terms["1A"]).toEqual(["math115"]);
    expect(r.choiceGroupsByTerm["1A"]).toEqual([
      {
        description: "Complete 1 of the following",
        selectCount: 1,
        options: ["cs115", "cs135", "cs145"],
      },
    ]);
    expect(r.warnings).toEqual([]);
  });

  it("silently skips 'Complete N approved electives' (no warning, no code)", () => {
    const html = `
      <section>
        <header><h2 data-testid="grouping-label"><span>4A Term</span></h2></header>
        <div data-test="ruleView-A-result">Complete 3 approved electives</div>
      </section>`;
    const r = parseProgramRequirements(
      { requiredCoursesTermByTerm: html },
      "test",
    );
    if (r.kind !== "engineering") throw new Error("expected engineering");
    expect(r.terms["4A"]).toEqual([]);
    expect(r.choiceGroupsByTerm["4A"]).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
});

describe("parseProgramRequirements — flexible programs", () => {
  it("biology: extracts flat required courses from the 'requirements' field", () => {
    const r = parseProgramRequirements(
      { requirements: fixture("biology") },
      "biology",
    );
    if (r.kind !== "flexible") throw new Error("expected flexible");
    expect(r.requiredCourses).toContain("biol130");
    expect(r.requiredCourses).toContain("chem120");
    expect(r.requiredCourses.length).toBeGreaterThanOrEqual(19);
    // Biology has a couple of "Complete 1 of" choices (intro physics,
    // communications) alongside its required core.
    expect(r.choiceGroups.length).toBeGreaterThanOrEqual(1);
    for (const g of r.choiceGroups) {
      expect(g.selectCount).toBe(1);
      expect(g.options.length).toBeGreaterThan(1);
    }
  });

  it("pure-math: extracts flat required courses from courseRequirementsNoUnits", () => {
    const r = parseProgramRequirements(
      { courseRequirementsNoUnits: fixture("pure-math") },
      "pure-math",
    );
    if (r.kind !== "flexible") throw new Error("expected flexible");
    expect(r.requiredCourses.length).toBeGreaterThanOrEqual(5);
    for (const code of r.requiredCourses) {
      expect(code).toMatch(/^[a-z]{2,8}\d{3,4}[a-z]?$/);
    }
  });

  it("cs-bcs: extracts ChoiceGroups for each 'Complete 1 of'", () => {
    const r = parseProgramRequirements(
      { courseRequirementsNoUnits: fixture("cs-bcs") },
      "cs-bcs",
    );
    if (r.kind !== "flexible") throw new Error("expected flexible");
    // CS136L/CS341/CS350 are in the top-level "Complete all the following".
    expect(r.requiredCourses).toContain("cs136l");
    expect(r.requiredCourses).toContain("cs341");
    expect(r.requiredCourses).toContain("cs350");
    // Intro CS variant — CS115/CS135/CS145 — must come through as a ChoiceGroup.
    const intro = r.choiceGroups.find(
      (g) => g.options.includes("cs135") && g.options.includes("cs115"),
    );
    expect(intro?.options).toEqual(["cs115", "cs135", "cs145"]);
    expect(intro?.selectCount).toBe(1);
    // Plenty of nested choice groups in CS BCS.
    expect(r.choiceGroups.length).toBeGreaterThanOrEqual(5);
  });

  it("cs-bcs: choiceGroups are sorted by first option for diff stability", () => {
    const r = parseProgramRequirements(
      { courseRequirementsNoUnits: fixture("cs-bcs") },
      "cs-bcs",
    );
    if (r.kind !== "flexible") throw new Error("expected flexible");
    const firsts = r.choiceGroups.map((g) => g.options[0]);
    expect(firsts).toEqual([...firsts].sort());
  });

  it("history: silently skips 'Complete X additional units' prose", () => {
    const r = parseProgramRequirements(
      { courseRequirementsNoUnits: fixture("history") },
      "history",
    );
    if (r.kind !== "flexible") throw new Error("expected flexible");
    expect(r.warnings).toEqual([]);
    // Should have many choice groups (the B.1, B.2, B.3 style suffixes).
    expect(r.choiceGroups.length).toBeGreaterThanOrEqual(3);
  });
});

describe("parseProgramRequirements — field-selection precedence", () => {
  it("requiredCoursesTermByTerm wins over requirements", () => {
    const r = parseProgramRequirements({
      requiredCoursesTermByTerm: fixture("syde"),
      requirements: fixture("biology"),
    });
    expect(r.kind).toBe("engineering");
  });

  it("requirements wins over courseRequirementsNoUnits", () => {
    const r = parseProgramRequirements({
      requirements: fixture("biology"),
      courseRequirementsNoUnits: fixture("cs-bcs"),
    });
    if (r.kind !== "flexible") throw new Error("expected flexible");
    expect(r.requiredCourses).toContain("biol130");
    expect(r.requiredCourses).not.toContain("cs136l");
  });

  it("falls through to courseRequirementsNoUnits when the others are empty", () => {
    const r = parseProgramRequirements({
      requiredCoursesTermByTerm: "",
      requirements: "",
      courseRequirementsNoUnits: fixture("pure-math"),
    });
    expect(r.kind).toBe("flexible");
  });
});

describe("normalizeCourseCode", () => {
  it("lowercases and removes whitespace", () => {
    expect(normalizeCourseCode("MATH 115")).toBe("math115");
    expect(normalizeCourseCode("SYDE101")).toBe("syde101");
  });

  it("preserves trailing letter (e.g. 101L, 240E)", () => {
    expect(normalizeCourseCode("SYDE101L")).toBe("syde101l");
    expect(normalizeCourseCode("CS 240E")).toBe("cs240e");
  });

  it("returns null for non-course-code text", () => {
    expect(normalizeCourseCode("Technical Elective")).toBeNull();
    expect(normalizeCourseCode("")).toBeNull();
    expect(normalizeCourseCode("CS")).toBeNull();
  });

  it("handles a 4-digit course number (e.g. SYDE 1000)", () => {
    expect(normalizeCourseCode("SYDE 1000")).toBe("syde1000");
  });

  it("handles a 4-digit code with trailing letter (e.g. SYDE 1000L)", () => {
    expect(normalizeCourseCode("SYDE1000L")).toBe("syde1000l");
  });
});

describe("buildProgramSlug + buildConflictCounts", () => {
  it("strips H- prefix when slug is unique", () => {
    const counts = buildConflictCounts([
      "H-Systems Design Engineering",
      "H-Civil Engineering",
    ]);
    expect(buildProgramSlug("H-Systems Design Engineering", counts)).toBe(
      "systems-design-engineering",
    );
  });

  it("retains prefix when stripped slug would collide", () => {
    const codes = ["H-Anthropology", "3G-Anthropology", "4G-Anthropology"];
    const counts = buildConflictCounts(codes);
    expect(buildProgramSlug("H-Anthropology", counts)).toBe("h-anthropology");
    expect(buildProgramSlug("3G-Anthropology", counts)).toBe("3g-anthropology");
    expect(buildProgramSlug("4G-Anthropology", counts)).toBe("4g-anthropology");
  });

  it("handles parenthetical disambiguation like CS BCS vs CS BMath", () => {
    const codes = [
      "H-Computer Science (BCS)",
      "JH-Computer Science (BCS)",
      "H-Computer Science (BMath)",
      "JH-Computer Science (BMath)",
    ];
    const counts = buildConflictCounts(codes);
    expect(buildProgramSlug("H-Computer Science (BCS)", counts)).toBe(
      "h-computer-science-bcs",
    );
    expect(buildProgramSlug("JH-Computer Science (BCS)", counts)).toBe(
      "jh-computer-science-bcs",
    );
  });

  it("converts ampersand to 'and'", () => {
    const counts = buildConflictCounts(["H-Accounting & Financial Management"]);
    expect(
      buildProgramSlug("H-Accounting & Financial Management", counts),
    ).toBe("accounting-and-financial-management");
  });
});

describe("parseElectives — empty input", () => {
  it("returns empty arrays when no fields are present", () => {
    const r = parseElectives({});
    expect(r.electives).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("returns empty arrays for whitespace-only fields", () => {
    const r = parseElectives({
      graduationRequirements: "  \n  ",
      courseListsNew: "",
    });
    expect(r.electives).toEqual([]);
  });
});

describe("parseElectives — graduationRequirements (Climate fixture)", () => {
  const r = parseElectives(
    { graduationRequirements: fixture("climate-grad-reqs") },
    "climate",
  );

  it("extracts the non-required unit buckets", () => {
    expect(r.electives).toEqual([
      { description: "2.0 units of approved courses", unitRequirement: 2.0 },
      { description: "6.0 units of elective courses", unitRequirement: 6.0 },
    ]);
  });

  it("filters out the 'required courses' bucket", () => {
    expect(
      r.electives.find((e) => /required/i.test(e.description)),
    ).toBeUndefined();
  });
});

describe("parseElectives — graduationRequirements (Biology fixture)", () => {
  const r = parseElectives(
    { graduationRequirements: fixture("biology-grad-reqs") },
    "biology",
  );

  it("captures the elective-courses bucket", () => {
    expect(r.electives).toContainEqual({
      description: "5.5 units of elective courses",
      unitRequirement: 5.5,
    });
  });

  it("does not match 'X.Y additional <subj> units' phrasing", () => {
    expect(
      r.electives.find((e) => /BIOL/i.test(e.description)),
    ).toBeUndefined();
  });

  it("filters out the required-courses bucket", () => {
    expect(
      r.electives.find((e) => /required/i.test(e.description)),
    ).toBeUndefined();
  });
});

describe("parseElectives — courseListsNew (Climate fixture)", () => {
  const r = parseElectives(
    { courseListsNew: fixture("climate-course-lists") },
    "climate",
  );

  it("emits one entry per section using the <h2> as description", () => {
    expect(r.electives).toHaveLength(1);
    expect(r.electives[0].description).toBe("Approved Courses List");
  });

  it("extracts the unit requirement from the 'Complete X.Y units' rule", () => {
    expect(r.electives[0].unitRequirement).toBe(2.0);
  });

  it("collects all course codes from <a> tags into approvedCourses", () => {
    expect(r.electives[0].approvedCourses).toEqual([
      "biol462",
      "earth444",
      "envs459",
      "ers484",
      "geog402",
      "geog403",
      "geog404",
      "geog407",
      "geog408",
      "geog420",
      "geog457",
      "geog490b",
    ]);
  });
});

describe("parseElectives — both fields (Climate)", () => {
  const r = parseElectives(
    {
      graduationRequirements: fixture("climate-grad-reqs"),
      courseListsNew: fixture("climate-course-lists"),
    },
    "climate",
  );

  it("merges the courseListsNew entry into the matching gradReqs bucket", () => {
    expect(r.electives).toHaveLength(2);
  });

  it("keeps the gradReqs prose as the description and attaches approvedCourses", () => {
    const approved = r.electives.find((e) => e.unitRequirement === 2.0);
    expect(approved?.description).toBe("2.0 units of approved courses");
    expect(approved?.approvedCourses).toEqual([
      "biol462",
      "earth444",
      "envs459",
      "ers484",
      "geog402",
      "geog403",
      "geog404",
      "geog407",
      "geog408",
      "geog420",
      "geog457",
      "geog490b",
    ]);
  });

  it("leaves the elective-courses bucket untouched (no courseList match)", () => {
    const elective = r.electives.find((e) => e.unitRequirement === 6.0);
    expect(elective).toEqual({
      description: "6.0 units of elective courses",
      unitRequirement: 6.0,
    });
  });

  it("does not emit a standalone 'Approved Courses List' entry after merging", () => {
    expect(
      r.electives.find((e) => e.description === "Approved Courses List"),
    ).toBeUndefined();
  });
});

describe("parseElectives — courseListsNew without matching gradReqs bucket", () => {
  it("appends the courseList entry standalone when no unitRequirement matches", () => {
    // gradReqs only has a 5.5-unit bucket; courseLists has a 2.0-unit section.
    // No unit match → courseList entry should appear standalone.
    const r = parseElectives(
      {
        graduationRequirements: fixture("biology-grad-reqs"),
        courseListsNew: fixture("climate-course-lists"),
      },
      "mixed",
    );
    const fromGradReqs = r.electives.find((e) => e.unitRequirement === 5.5);
    expect(fromGradReqs).toBeDefined();
    expect(fromGradReqs?.approvedCourses).toBeUndefined();
    const fromCourseLists = r.electives.find(
      (e) => e.description === "Approved Courses List",
    );
    expect(fromCourseLists?.unitRequirement).toBe(2.0);
    expect(fromCourseLists?.approvedCourses).toContain("biol462");
  });
});

describe("parseElectives — ambiguous merge guard", () => {
  it("pushes the courseList entry standalone when multiple gradReqs buckets share its unitRequirement", () => {
    // Two gradReqs entries with the same unit count → can't safely tell
    // which one the courseList section enriches. Push standalone.
    const gradReqs = `
      <ul>
        <li>2.0 units of approved courses.</li>
        <li>2.0 units of communications courses.</li>
      </ul>`;
    const r = parseElectives(
      {
        graduationRequirements: gradReqs,
        courseListsNew: fixture("climate-course-lists"),
      },
      "ambiguous",
    );
    expect(r.electives).toHaveLength(3);
    // Neither gradReqs bucket should have been mutated.
    const gradReqsBuckets = r.electives.filter(
      (e) => e.description !== "Approved Courses List",
    );
    expect(gradReqsBuckets).toHaveLength(2);
    for (const e of gradReqsBuckets) {
      expect(e.approvedCourses).toBeUndefined();
    }
    // The courseList entry survives as its own row, with its course list.
    const courseList = r.electives.find(
      (e) => e.description === "Approved Courses List",
    );
    expect(courseList?.approvedCourses).toContain("biol462");
  });
});

describe("parseElectives — deterministic ordering", () => {
  it("sorts the merged result by unitRequirement, then description", () => {
    const gradReqs = `
      <ul>
        <li>6.0 units of elective courses.</li>
        <li>2.0 units of approved courses.</li>
      </ul>`;
    const r = parseElectives({ graduationRequirements: gradReqs });
    expect(r.electives.map((e) => e.unitRequirement)).toEqual([2.0, 6.0]);
  });
});
