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
    expect(inferCompleted("syde", "1A")).toEqual([]);
  });

  it("seeds SYDE 2A with 1A + 1B core courses", () => {
    const seeded = inferCompleted("syde", "2A");
    // Strictly before 2A means 1A ∪ 1B.
    const expected = new Set([
      ...PROGRAMS.syde.terms["1A"],
      ...PROGRAMS.syde.terms["1B"],
    ]);
    expect(new Set(seeded)).toEqual(expected);
  });

  it("seeds SYDE 3A with 1A through 2B (syde322 not in seed but is the smoke-test target)", () => {
    const seeded = new Set(inferCompleted("syde", "3A"));
    // A representative course from each of 1A, 1B, 2A, 2B should be present.
    expect(seeded.has("syde101")).toBe(true);
    expect(seeded.has("syde192")).toBe(true);
    expect(seeded.has("syde201")).toBe(true);
    expect(seeded.has("syde262")).toBe(true);
    // 3A courses themselves should NOT be in the seed.
    expect(seeded.has("syde301")).toBe(false);
  });

  it("returns sorted unique codes", () => {
    const seeded = inferCompleted("syde", "4B");
    const sorted = [...seeded].sort();
    expect(seeded).toEqual(sorted);
    expect(new Set(seeded).size).toBe(seeded.length);
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
  it("accepts the 5 curated programs", () => {
    for (const id of ["syde", "cs", "ece", "se", "mte"]) {
      expect(isKnownProgram(id)).toBe(true);
    }
  });

  it("rejects unknown ids", () => {
    expect(isKnownProgram("phys")).toBe(false);
    expect(isKnownProgram("SYDE")).toBe(false); // case-sensitive; URL decode normalizes first
    expect(isKnownProgram(null)).toBe(false);
  });
});
