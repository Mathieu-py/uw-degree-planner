import { describe, expect, it, vi } from "vitest";
import type { Program, RuleNode, Specialization } from "../index";
import { memoizedReferencedCodes, referencedCodesOf } from "../referenced";

const SPEC: Specialization = {
  slug: "widgets",
  name: "Widgets Specialization",
  kualiId: "k-widgets",
  rules: { kind: "courses", courses: ["SYDE 411"] },
  electives: [{ description: "Spec electives", approvedCourses: ["SYDE 533"] }],
};

const PROGRAM: Program = {
  kind: "flexible",
  name: "Testing (Bachelor of Testing)",
  asOf: "2026-01-01",
  rules: {
    kind: "all",
    children: [
      { kind: "courses", courses: ["CS 115", "MATH 135"] },
      {
        kind: "pick",
        selectMin: 1,
        children: [{ kind: "courses", courses: ["STAT 230"] }],
      },
      // Neither pools nor exclusions name concrete referenced courses.
      { kind: "subjectPool", selectCount: 2, subjectCodes: ["ECON"] },
      { kind: "excluded", courses: ["PHYS 111"] },
    ],
  },
  electives: [
    { description: "Approved list", approvedCourses: ["ENGL 109"] },
    { description: "Unit bucket, no list", unitRequirement: 1.0 },
  ],
  specializations: [SPEC],
};

describe("referencedCodesOf", () => {
  it("collects rule-tree and elective codes, lowercased, skipping pools and exclusions", () => {
    expect(referencedCodesOf(PROGRAM)).toEqual(
      new Set(["cs 115", "math 135", "stat 230", "engl 109"]),
    );
  });

  it("adds the passed spec's rules and electives", () => {
    expect(referencedCodesOf(PROGRAM, SPEC)).toEqual(
      new Set([
        "cs 115",
        "math 135",
        "stat 230",
        "engl 109",
        "syde 411",
        "syde 533",
      ]),
    );
  });

  it("collects across every term tree of an engineering program", () => {
    const filler: RuleNode = { kind: "courses", courses: ["GENE 123"] };
    const eng: Program = {
      kind: "engineering",
      name: "Widget Engineering (Bachelor of Applied Science)",
      asOf: "2026-01-01",
      terms: {
        "1A": { kind: "courses", courses: ["SYDE 101"] },
        "1B": filler,
        "2A": filler,
        "2B": filler,
        "3A": filler,
        "3B": filler,
        "4A": filler,
        "4B": { kind: "courses", courses: ["SYDE 461"] },
      },
    };
    expect(referencedCodesOf(eng)).toEqual(
      new Set(["syde 101", "gene 123", "syde 461"]),
    );
  });
});

describe("memoizedReferencedCodes", () => {
  it("cacheMisses:true pins the empty set for an unknown id", () => {
    const resolve = vi.fn((): Program | undefined => undefined);
    const lookup = memoizedReferencedCodes(resolve, { cacheMisses: true });
    const first = lookup("ghost");
    const second = lookup("ghost");
    expect(first.size).toBe(0);
    expect(second).toBe(first);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("cacheMisses:false recomputes each miss, then memoizes once resolved", () => {
    const resolve = vi
      .fn((): Program | undefined => undefined)
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined)
      .mockReturnValue(PROGRAM);
    const lookup = memoizedReferencedCodes(resolve, { cacheMisses: false });
    expect(lookup("p1").size).toBe(0);
    expect(lookup("p1").size).toBe(0);
    expect(resolve).toHaveBeenCalledTimes(2);
    const loaded = lookup("p1");
    expect(loaded).toEqual(referencedCodesOf(PROGRAM));
    expect(lookup("p1")).toBe(loaded);
    expect(resolve).toHaveBeenCalledTimes(3);
  });

  it("resolves the spec by slug and keys the memo per (id, spec)", () => {
    const resolve = vi.fn(() => PROGRAM);
    const lookup = memoizedReferencedCodes(resolve, { cacheMisses: true });
    expect(lookup("p1", "widgets")).toEqual(referencedCodesOf(PROGRAM, SPEC));
    expect(lookup("p1")).toEqual(referencedCodesOf(PROGRAM));
    expect(resolve).toHaveBeenCalledTimes(2);
    lookup("p1", "widgets");
    lookup("p1");
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("invalidate(id) drops all of that id's entries but no other id's", () => {
    const resolve = vi.fn(() => PROGRAM);
    const lookup = memoizedReferencedCodes(resolve, { cacheMisses: true });
    lookup("p1");
    lookup("p1", "widgets");
    lookup("other");
    expect(resolve).toHaveBeenCalledTimes(3);

    lookup.invalidate("p1");
    lookup("p1");
    lookup("p1", "widgets");
    expect(resolve).toHaveBeenCalledTimes(5);
    lookup("other");
    expect(resolve).toHaveBeenCalledTimes(5);
  });

  it("returns the empty set for a nullish id without resolving", () => {
    const resolve = vi.fn(() => PROGRAM);
    const lookup = memoizedReferencedCodes(resolve, { cacheMisses: true });
    expect(lookup(null).size).toBe(0);
    expect(lookup(undefined).size).toBe(0);
    expect(resolve).not.toHaveBeenCalled();
  });
});
