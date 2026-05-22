import { describe, expect, it } from "vitest";
import {
  PROGRAMS,
  TERM_LETTERS,
  inferCompleted,
  isKnownProgram,
  isTermLetter,
} from "../programs";

describe("inferCompleted", () => {
  it("returns [] for an unknown program", () => {
    expect(inferCompleted("not-a-program", "3A")).toEqual([]);
  });

  it("returns [] when currentTerm is 1A (nothing before it)", () => {
    expect(inferCompleted("systems-design-engineering", "1A")).toEqual([]);
  });

  it("seeds SYDE 2A with 1A + 1B core courses", () => {
    const seeded = inferCompleted("systems-design-engineering", "2A");
    const expected = new Set([
      ...PROGRAMS["systems-design-engineering"].terms["1A"],
      ...PROGRAMS["systems-design-engineering"].terms["1B"],
    ]);
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

describe("programs.json schema integrity", () => {
  it("all programs have all 8 term arrays", () => {
    for (const [id, prog] of Object.entries(PROGRAMS)) {
      for (const term of TERM_LETTERS) {
        expect(
          Array.isArray(prog.terms[term]),
          `${id}.terms.${term} should be an array`,
        ).toBe(true);
      }
    }
  });

  it("every program has at least one non-empty term (scraper enforces this)", () => {
    for (const [id, prog] of Object.entries(PROGRAMS)) {
      const hasAny = TERM_LETTERS.some((t) => prog.terms[t].length > 0);
      expect(hasAny, `${id} should have at least one non-empty term`).toBe(true);
    }
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
  it("accepts well-known scraped program slugs", () => {
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

  it("rejects programs that were pruned from data/programs.json", () => {
    // h-computer-science-bcs and friends had no per-term schedule data and
    // were dropped during the prune. Confirm they're gone — if they reappear,
    // the parser refactor (Issues B-D) probably needs a corresponding update
    // to the dropdown's filter.
    expect(isKnownProgram("h-computer-science-bcs")).toBe(false);
    expect(isKnownProgram("3g-anthropology")).toBe(false);
    expect(isKnownProgram("h-history")).toBe(false);
  });

  it("rejects unknown ids", () => {
    expect(isKnownProgram("phys")).toBe(false);
    expect(isKnownProgram("SYSTEMS-DESIGN-ENGINEERING")).toBe(false);
    expect(isKnownProgram(null)).toBe(false);
  });
});
