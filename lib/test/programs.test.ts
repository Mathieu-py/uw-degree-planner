import { describe, expect, it } from "vitest";
import {
  getRequiredCourses,
  getTermSchedule,
  inferCompleted,
  isKnownProgram,
  isTermLetter,
  PROGRAMS,
  TERM_LETTERS,
} from "../programs";

describe("inferCompleted (engineering)", () => {
  it("returns [] for an unknown program", () => {
    expect(inferCompleted("not-a-program", "3A")).toEqual([]);
  });

  it("returns [] when currentTerm is 1A (nothing before it)", () => {
    expect(inferCompleted("systems-design-engineering", "1A")).toEqual([]);
  });

  it("returns [] when currentTerm is null on an engineering program", () => {
    expect(inferCompleted("systems-design-engineering", null)).toEqual([]);
  });

  it("seeds SYDE 2A with 1A + 1B core courses", () => {
    const seeded = inferCompleted("systems-design-engineering", "2A");
    const syde = PROGRAMS["systems-design-engineering"];
    if (syde.kind !== "engineering")
      throw new Error("SYDE should be engineering");
    const expected = new Set([...syde.terms["1A"], ...syde.terms["1B"]]);
    expect(new Set(seeded)).toEqual(expected);
  });

  it("seeds SYDE 3A with 1A through 2B", () => {
    const seeded = new Set(inferCompleted("systems-design-engineering", "3A"));
    expect(seeded.has("syde101")).toBe(true);
    expect(seeded.has("syde161")).toBe(true);
    expect(seeded.has("math115")).toBe(true);
    expect(seeded.has("syde321")).toBe(false);
  });

  it("returns sorted unique codes", () => {
    const seeded = inferCompleted("systems-design-engineering", "4B");
    const sorted = [...seeded].sort();
    expect(seeded).toEqual(sorted);
    expect(new Set(seeded).size).toBe(seeded.length);
  });
});

describe("inferCompleted (flexible)", () => {
  const flexibleSlugs = Object.entries(PROGRAMS)
    .filter(([, p]) => p.kind === "flexible")
    .map(([id]) => id);

  it.runIf(flexibleSlugs.length > 0)(
    "returns all requiredCourses regardless of currentTerm",
    () => {
      const id = flexibleSlugs[0];
      const program = PROGRAMS[id];
      if (program.kind !== "flexible") throw new Error("expected flexible");
      const withNull = inferCompleted(id, null);
      const with2A = inferCompleted(id, "2A");
      expect(withNull).toEqual([...program.requiredCourses].sort());
      expect(with2A).toEqual(withNull);
    },
  );
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

  it("engineering programs have all 8 term arrays", () => {
    for (const [id, prog] of Object.entries(PROGRAMS)) {
      if (prog.kind !== "engineering") continue;
      for (const term of TERM_LETTERS) {
        expect(
          Array.isArray(prog.terms[term]),
          `${id}.terms.${term} should be an array`,
        ).toBe(true);
      }
    }
  });

  it("every program has at least some captured data (required courses or choice groups)", () => {
    // A program with empty terms / empty requiredCourses but populated
    // choiceGroups is still valid — see e.g. 3g-mathematics, which is
    // entirely choice-driven. The scraper drops only programs that yield
    // none of the three.
    for (const [id, prog] of Object.entries(PROGRAMS)) {
      const hasRequired = getRequiredCourses(prog).length > 0;
      const hasChoices =
        prog.kind === "engineering"
          ? Object.values(prog.choiceGroupsByTerm ?? {}).some(
              (arr) => arr.length > 0,
            )
          : (prog.choiceGroups?.length ?? 0) > 0;
      expect(
        hasRequired || hasChoices,
        `${id} should have required courses or choice groups`,
      ).toBe(true);
    }
  });
});

describe("getRequiredCourses / getTermSchedule", () => {
  it("getRequiredCourses returns union of terms for engineering", () => {
    const syde = PROGRAMS["systems-design-engineering"];
    if (syde.kind !== "engineering")
      throw new Error("SYDE should be engineering");
    const required = getRequiredCourses(syde);
    expect(required).toContain("syde101");
    expect(required).toEqual([...required].sort());
    expect(new Set(required).size).toBe(required.length);
  });

  it("getTermSchedule returns null for flexible programs", () => {
    const flex = Object.values(PROGRAMS).find((p) => p.kind === "flexible");
    if (flex) expect(getTermSchedule(flex)).toBeNull();
  });

  it("getTermSchedule returns the terms record for engineering", () => {
    const syde = PROGRAMS["systems-design-engineering"];
    expect(getTermSchedule(syde)).toBe(
      syde.kind === "engineering" ? syde.terms : null,
    );
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
