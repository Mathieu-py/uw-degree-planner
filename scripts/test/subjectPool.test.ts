import { describe, expect, it } from "vitest";
import type { RuleNode } from "../../lib/programs";
import { catalogCodesInRange } from "../scrape/catalog";
import { parseCodeRange } from "../scrape/normalize";
import { parseChooseAnyPool, parseSubjectPool } from "../scrape/subjectPool";

function pool(node: RuleNode | null) {
  if (!node || node.kind !== "subjectPool")
    throw new Error("not a subjectPool");
  return node;
}

describe("parseSubjectPool — bucket A: 'in any combination, chosen from' preamble", () => {
  it("recovers a subject-code pool past the connective preamble", () => {
    const p = pool(
      parseSubjectPool(
        "Complete 1.0 unit of courses, in any combination, chosen from the following subject codes: BET, BUS, COMM, STV",
      ),
    );
    expect(p.subjectCodes).toEqual(["BET", "BUS", "COMM", "STV"]);
    expect(p.selectCount).toBe(2); // 1.0 unit ÷ 0.5
  });

  it("handles 'in any combination, from' without 'chosen'", () => {
    const p = pool(
      parseSubjectPool(
        "Complete 1.0 unit of courses, in any combination, from the following subjects: ANTH, SOC",
      ),
    );
    expect(p.subjectCodes).toEqual(["ANTH", "SOC"]);
  });

  it("keeps a level bound alongside the preamble", () => {
    const p = pool(
      parseSubjectPool(
        "Complete 1.0 unit at the 300-level, chosen from the following subject codes: BET, BUS",
      ),
    );
    expect(p.subjectCodes).toEqual(["BET", "BUS"]);
    expect(p.minLevel).toBe(300);
  });

  it("still returns null for 'in any combination' with no 'from' list (guard)", () => {
    // The lookahead means the strip only fires when a real list follows.
    expect(
      parseSubjectPool(
        "Complete 1.0 unit of Science courses in any combination",
      ),
    ).toBeNull();
  });
});

describe("parseChooseAnyPool — bucket C: pool with no 'Complete N' head", () => {
  it("parses 'any CS course at the 600- or 700-level' into a level-bounded pool", () => {
    const p = pool(
      parseChooseAnyPool("any CS course at the 600- or 700-level"),
    );
    expect(p.subjectCodes).toEqual(["CS"]);
    expect(p.minLevel).toBe(600);
    expect(p.maxLevel).toBe(700);
    expect(p.selectCount).toBe(1);
  });

  it("parses the slash form 'any CS course at the 600-/700-level'", () => {
    const p = pool(parseChooseAnyPool("any CS course at the 600-/700-level"));
    expect(p.minLevel).toBe(600);
    expect(p.maxLevel).toBe(700);
  });

  it("strips a 'Choose any course from the following:' frame", () => {
    const p = pool(
      parseChooseAnyPool("Choose any course from the following: CS courses"),
    );
    expect(p.subjectCodes).toEqual(["CS"]);
  });

  it("returns null when no subject is named", () => {
    expect(parseChooseAnyPool("any course at the 600-level")).toBeNull();
  });
});

describe("parseSubjectPool — bucket B: faculty-scoped pools", () => {
  it("expands 'courses in the Faculty of Arts' to that faculty's subjects", () => {
    const p = pool(
      parseSubjectPool("Complete 1.0 unit of courses in the Faculty of Arts"),
    );
    expect(p.subjectCodes).toContain("ANTH");
    expect(p.subjectCodes).toContain("HIST");
    expect(p.subjectCodes).not.toContain("CS"); // CS is Mathematics
    expect(p.selectCount).toBe(2); // 1.0 unit ÷ 0.5
  });

  it("expands a multi-faculty 'Faculties: Environment, Health, Science' clause", () => {
    const p = pool(
      parseSubjectPool(
        "Complete 1.0 unit of courses, in any combination, chosen from the following Faculties: Environment, Health, Science",
      ),
    );
    expect(p.subjectCodes).toContain("GEOG"); // Environment
    expect(p.subjectCodes).toContain("KIN"); // Health
    expect(p.subjectCodes).toContain("BIOL"); // Science
    expect(p.subjectCodes).not.toContain("ANTH"); // Arts not named
  });

  it("keeps BOTH halves of a 'Faculty of Arts, or … subject codes' compound rule", () => {
    const p = pool(
      parseSubjectPool(
        "Complete 1.0 unit of courses, in any combination, chosen from the Faculty of Arts, or from the following subject codes: BET, BUS, COMM, STV",
      ),
    );
    // The explicit subject codes…
    for (const code of ["BET", "BUS", "COMM", "STV"])
      expect(p.subjectCodes).toContain(code);
    // …unioned with the Faculty of Arts subjects.
    expect(p.subjectCodes).toContain("ANTH");
  });

  it("returns null for an unrecognized faculty with no other subjects", () => {
    expect(
      parseSubjectPool(
        "Complete 1.0 unit of courses in the Faculty of Hogwarts",
      ),
    ).toBeNull();
  });
});

describe("parseCodeRange", () => {
  it("parses a re-prefixed range 'CS440-CS498'", () => {
    expect(parseCodeRange("CS440-CS498")).toEqual({
      prefix: "cs",
      lo: 440,
      hi: 498,
    });
  });

  it("parses an inherit-prefix range 'CS240-299'", () => {
    expect(parseCodeRange("CS240-299")).toEqual({
      prefix: "cs",
      lo: 240,
      hi: 299,
    });
  });

  it("returns null for a non-range token", () => {
    expect(parseCodeRange("CS136")).toBeNull();
  });
});

describe("catalogCodesInRange — expands against the committed snapshot", () => {
  it("includes an in-band member and excludes out-of-band", () => {
    const codes = catalogCodesInRange({ prefix: "cs", lo: 440, hi: 498 });
    expect(codes).toContain("cs486"); // in band, exists
    expect(codes).not.toContain("cs136"); // out of band
    // Only real codes — no synthesized "cs440" (it doesn't exist in the snapshot).
    expect(codes).not.toContain("cs440");
  });

  it("expands an absent subject to nothing", () => {
    expect(catalogCodesInRange({ prefix: "zzzz", lo: 100, hi: 900 })).toEqual(
      [],
    );
  });
});
