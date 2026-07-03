import { describe, expect, it } from "vitest";
import type { RuleNode } from "../../lib/programs";
import {
  parseChooseAnyPool,
  parseSubjectPool,
} from "../scrape/requirements/subjectPool";
import { catalogCodesInRange } from "../scrape/util/catalog";
import { parseCodeRange } from "../scrape/util/normalize";

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

  it("keeps the last code when the clause ends with a period (STV.)", () => {
    // A trailing "." must not defeat the subject-code filter.
    const p = pool(
      parseSubjectPool(
        "Complete 1.0 unit of courses, in any combination, chosen from the following subject codes: BET, BUS, COMM, STV.",
      ),
    );
    expect(p.subjectCodes).toEqual(["BET", "BUS", "COMM", "STV"]);
  });
});

describe("parseSubjectPool — unit-stated pools carry needUnits", () => {
  it("records the real unit requirement so the audit scores by units", () => {
    const p = pool(
      parseSubjectPool(
        "Complete 1.0 unit of courses, in any combination, chosen from the following subject codes: BET, BUS, COMM, STV",
      ),
    );
    expect(p.needUnits).toBe(1.0); // the audit gates on units…
    expect(p.selectCount).toBe(2); // …selectCount is only a ÷0.5 display count
  });

  it("leaves needUnits unset for a count-based 'Choose any' pool", () => {
    const p = pool(parseChooseAnyPool("Choose any CS course at the 600-level"));
    expect(p.needUnits).toBeUndefined();
    expect(p.selectCount).toBe(1);
  });
});

describe("parseSubjectPool — level enumerations", () => {
  it("parses a 3-way enumeration '200-, 300-, or 400-level' as a min..max range", () => {
    const p = pool(
      parseSubjectPool(
        "Complete 1.0 unit at the 200-, 300-, or 400-level from the following subject codes: CS",
      ),
    );
    expect(p.minLevel).toBe(200);
    expect(p.maxLevel).toBe(400);
  });

  it("treats a single level with 'or above' as a floor (no max)", () => {
    const p = pool(
      parseSubjectPool(
        "Complete 1.0 unit at the 300-level or above from: MATH",
      ),
    );
    expect(p.minLevel).toBe(300);
    expect(p.maxLevel).toBeUndefined();
  });
});

describe("parseSubjectPool — whole-course count invariant", () => {
  it("clamps a fractional count to one course (a pool can't need half a course)", () => {
    // Biochem's "0.5 … BIOL courses at the 200-level" parsed as a 0.5-course
    // pool, summing into the degree chip as a nonsensical "0 / 39.5". A pool
    // selects whole courses; the floor is one.
    const p = pool(
      parseSubjectPool("Complete 0.5 BIOL courses at the 200-level"),
    );
    expect(p.subjectCodes).toEqual(["BIOL"]);
    expect(p.minLevel).toBe(200);
    expect(p.selectCount).toBe(1);
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

  it("does not absorb the Math faculty from a 'MATH' subject code after 'and from'", () => {
    // "and from" (not "or from") once let the faculty capture run past "Arts" into
    // the subject list, where "MATH" wrongly matched the whole Math faculty. The
    // pool must scope to Arts + the two named codes only. Regression for #117 (B).
    const p = pool(
      parseSubjectPool(
        "Complete 1.0 unit of courses, in any combination, chosen from the Faculty of Arts, and from the following subject codes: BET, MATH",
      ),
    );
    expect(p.subjectCodes).toContain("ANTH"); // Faculty of Arts
    expect(p.subjectCodes).toContain("BET");
    expect(p.subjectCodes).toContain("MATH");
    expect(p.subjectCodes).not.toContain("ACTSC"); // Math faculty NOT absorbed
    expect(p.subjectCodes).not.toContain("PMATH");
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

  it("rejects a mixed-subject range rather than coercing it to the start", () => {
    expect(parseCodeRange("CS440-MATH498")).toBeNull();
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

describe("parseSubjectPool — R5: exact unit-stated pools", () => {
  it("reads a count-less 'to a total of N units' single-subject pool", () => {
    const p = pool(
      parseSubjectPool(
        "Complete additional units of PSCI courses at any level to a total of 8.0 units",
      ),
    );
    expect(p.subjectCodes).toEqual(["PSCI"]);
    expect(p.selectCount).toBe(16); // 8.0 ÷ 0.5
    expect(p.minLevel).toBeUndefined(); // "any level" adds no bound
  });

  it("reads a multi-subject 'to a total of N units' pool", () => {
    const p = pool(
      parseSubjectPool(
        "Complete additional units of COMMST, DAC, THPERF courses at any level to a total of 8.0 units",
      ),
    );
    expect(p.subjectCodes).toEqual(["COMMST", "DAC", "THPERF"]);
    expect(p.selectCount).toBe(16);
  });

  it("reads 'Complete N <SUBJECT> electives' (noun 'electives', not 'courses')", () => {
    const p = pool(
      parseSubjectPool("Complete 2 PHARM electives for a total of 0.5 unit."),
    );
    expect(p.subjectCodes).toEqual(["PHARM"]);
    expect(p.selectCount).toBe(2);
  });

  it("reads a sized bare code 'BIOL 0.5 unit, any level'", () => {
    const p = pool(
      parseSubjectPool("Complete one additional BIOL 0.5 unit, any level"),
    );
    expect(p.subjectCodes).toEqual(["BIOL"]);
    expect(p.selectCount).toBe(1);
    expect(p.minLevel).toBeUndefined();
  });

  it("does NOT recover a pool carrying an un-encodable sub-floor (stays null)", () => {
    // "with a minimum of 1.0 units at the 300/400-level" can't be expressed by a
    // single pool's one level band — keep it unverified rather than over-count.
    expect(
      parseSubjectPool(
        "Complete an additional 2.0 units of any AMATH or PHYS courses, with a minimum of 1.0 units at the 300- or 400-level",
      ),
    ).toBeNull();
  });
});

describe("parseSubjectPool — caps are ceilings, not required floors", () => {
  // A cap on how much may count is not a requirement; the audit models only
  // floors (met when have >= need), so a cap must NOT become a gating pool —
  // it falls through to unverified instead.
  it("rejects an 'at most N units' unit ceiling", () => {
    expect(
      parseSubjectPool("Complete at most 2.0 units of PSYCH courses"),
    ).toBeNull();
  });

  it("rejects an 'a maximum of N courses' cap (the 'a' must not read as count 1)", () => {
    // Without the explicit cap guard, "a" is consumed as count 1 and a CS pool
    // of 1 is wrongly built from the trailing "maximum of 3 CS courses".
    expect(parseSubjectPool("Complete a maximum of 3 CS courses")).toBeNull();
  });

  it("rejects 'no more than' and 'up to' caps", () => {
    expect(
      parseSubjectPool("Complete no more than 2 PSYCH courses"),
    ).toBeNull();
    expect(parseSubjectPool("Complete up to 1.0 unit of PSYCH")).toBeNull();
  });

  it("still parses an 'at least N units' floor as a gating pool", () => {
    const p = pool(
      parseSubjectPool("Complete at least 2.0 units of PSYCH courses"),
    );
    expect(p.subjectCodes).toEqual(["PSYCH"]);
    expect(p.needUnits).toBe(2.0);
  });
});
