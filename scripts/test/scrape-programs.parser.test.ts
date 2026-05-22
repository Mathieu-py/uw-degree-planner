import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildConflictCounts,
  buildProgramSlug,
  normalizeCourseCode,
  parseRequiredCoursesTermByTerm,
} from "../scrape-programs.parser";

const fixture = (name: string) =>
  readFileSync(path.join(__dirname, "fixtures", `${name}.html`), "utf-8");

describe("parseRequiredCoursesTermByTerm — empty input", () => {
  it("returns all 8 terms with empty arrays for empty HTML", () => {
    const { terms, warnings } = parseRequiredCoursesTermByTerm("");
    expect(Object.keys(terms).sort()).toEqual([
      "1A",
      "1B",
      "2A",
      "2B",
      "3A",
      "3B",
      "4A",
      "4B",
    ]);
    for (const arr of Object.values(terms)) expect(arr).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("returns empty terms for whitespace-only HTML", () => {
    const { terms } = parseRequiredCoursesTermByTerm("   \n   ");
    for (const arr of Object.values(terms)) expect(arr).toEqual([]);
  });
});

describe("parseRequiredCoursesTermByTerm — SYDE fixture", () => {
  const { terms, warnings } = parseRequiredCoursesTermByTerm(
    fixture("syde"),
    "syde",
  );

  it("extracts 1A required courses", () => {
    expect(terms["1A"]).toEqual([
      "math115",
      "math117",
      "syde101",
      "syde121",
      "syde151",
      "syde161",
    ]);
  });

  it("extracts 1B required courses including syde101l (with letter suffix)", () => {
    expect(terms["1B"]).toContain("syde101l");
    expect(terms["1B"]).toContain("math119");
  });

  it("populates all 8 terms (Engineering programs have term-by-term data)", () => {
    for (const t of ["1A", "1B", "2A", "2B", "3A", "3B", "4A", "4B"] as const) {
      expect(terms[t].length).toBeGreaterThan(0);
    }
  });

  it("does not include elective-slot text as course codes", () => {
    const all = Object.values(terms).flat();
    for (const code of all) {
      expect(code).toMatch(/^[a-z]{2,8}\d{3}[a-z]?$/);
    }
  });

  it("emits no OR warnings for SYDE (engineering schedules are all 'Complete all')", () => {
    expect(warnings).toEqual([]);
  });
});

describe("parseRequiredCoursesTermByTerm — Computer Engineering fixture", () => {
  const { terms } = parseRequiredCoursesTermByTerm(fixture("cpe"), "cpe");

  it("extracts ECE 1A courses", () => {
    expect(terms["1A"]).toContain("ece105");
    expect(terms["1A"]).toContain("ece150");
  });

  it("output is sorted and deduped per term", () => {
    for (const codes of Object.values(terms)) {
      const sorted = [...codes].sort();
      expect(codes).toEqual(sorted);
      expect(new Set(codes).size).toBe(codes.length);
    }
  });
});

describe("parseRequiredCoursesTermByTerm — OR-group skip + warning", () => {
  it("logs a warning and skips courses for 'Complete 1 of the following' rules", () => {
    const html = `
      <section>
        <header><h2 data-testid="grouping-label"><span>1A Term</span></h2></header>
        <div>
          <div data-test="ruleView-A-result">
            Complete all the following:
            <a href="#">MATH115</a>
          </div>
          <div data-test="ruleView-A-result">
            Complete 1 of the following:
            <a href="#">CS115</a>
            <a href="#">CS135</a>
            <a href="#">CS145</a>
          </div>
        </div>
      </section>`;
    const { terms, warnings } = parseRequiredCoursesTermByTerm(html, "test");
    expect(terms["1A"]).toEqual(["math115"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("OR group skipped");
    expect(warnings[0]).toContain("test 1A");
  });

  it("skips 'Complete N approved electives' silently (no warning)", () => {
    const html = `
      <section>
        <header><h2 data-testid="grouping-label"><span>4A Term</span></h2></header>
        <div data-test="ruleView-A-result">Complete 3 approved electives</div>
      </section>`;
    const { terms, warnings } = parseRequiredCoursesTermByTerm(html, "test");
    expect(terms["4A"]).toEqual([]);
    expect(warnings).toEqual([]);
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
});

describe("normalizeCourseCode — 4-digit course numbers", () => {
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
    const codes = [
      "H-Anthropology",
      "3G-Anthropology",
      "4G-Anthropology",
    ];
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
    expect(buildProgramSlug("H-Accounting & Financial Management", counts)).toBe(
      "accounting-and-financial-management",
    );
  });
});
