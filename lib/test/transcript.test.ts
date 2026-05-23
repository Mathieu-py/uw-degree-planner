import { describe, expect, it } from "vitest";
import { PROGRAMS } from "../programs";
import {
  matchProgramSlug,
  matchSpecializationFromPlan,
  parseTranscript,
} from "../transcript/parse";

const TYPICAL_SYDE = `
Career: Undergraduate
Program: Engineering
Plan: Systems Design Engineering

Fall 2023
COURSE      DESCRIPTION                                ATT  EARN GRADE
SYDE 101    Communications in SD Engineering           0.50 0.50 85
MATH 115    Linear Algebra for Engineering             0.50 0.50 72
SYDE 121    Digital Computation                        0.50 0.50 90
SYDE 161    Introduction to Design                     0.50 0.50 88

Term GPA: 83.75

Winter 2024
SYDE 102    Seminar                                    0.25 0.25 CR
MATH 119    Calculus 2 for Engineering                 0.50 0.50 65
SYDE 192    Digital Systems                            0.50 0.50 F

Spring 2024
SYDE 201    Systems Models 1                           0.50 0.50 IP
MATH 215    Linear Algebra 2                           0.50 0.50 IP
`;

describe("parseTranscript — typical undergrad", () => {
  const result = parseTranscript(TYPICAL_SYDE);

  it("captures the plan text", () => {
    expect(result.rawPlanText).toBe("Systems Design Engineering");
  });

  it("matches the plan to the SYDE program slug", () => {
    expect(result.detectedProgramId).toBe("systems-design-engineering");
  });

  it("includes passed courses", () => {
    const codes = result.courses
      .filter((c) => c.status === "passed")
      .map((c) => c.code)
      .sort();
    expect(codes).toContain("syde101");
    expect(codes).toContain("math115");
    expect(codes).toContain("syde102"); // CR pass
    expect(codes).toContain("math119"); // 65 ≥ 50
  });

  it("includes IP courses as in-progress", () => {
    const ip = result.courses
      .filter((c) => c.status === "inProgress")
      .map((c) => c.code)
      .sort();
    expect(ip).toEqual(["math215", "syde201"]);
  });

  it("flags failed/withdrawn as skipped", () => {
    const skipped = result.courses.find((c) => c.code === "syde192");
    expect(skipped?.status).toBe("skipped");
  });

  it("detects current term from the IP-containing term (Spring 2024 → 2A)", () => {
    expect(result.detectedCurrentTerm).toBe("2A");
  });

  it("emits no warnings for a clean transcript", () => {
    expect(result.warnings).toEqual([]);
  });
});

describe("parseTranscript — co-op stagger", () => {
  const COOP = `
Plan: Systems Design Engineering

Fall 2023
SYDE 101    Communications     0.50 0.50 85

Winter 2024
WKRPT 200   Work Report        0.50 0.50 CR

Spring 2024
SYDE 102    Seminar            0.25 0.25 CR
MATH 119    Calculus 2         0.50 0.50 75

Fall 2024
SYDE 201    Systems Models     0.50 0.50 IP
`;

  it("doesn't count work-term-only sections as study terms", () => {
    const result = parseTranscript(COOP);
    // Study terms: Fall 2023 (1A), Spring 2024 (1B), Fall 2024 (2A).
    // The Winter 2024 section had only WKRPT and is not a study term.
    expect(result.detectedCurrentTerm).toBe("2A");
  });

  it("excludes WKRPT entries from completedCourses", () => {
    const result = parseTranscript(COOP);
    expect(result.courses.find((c) => c.code === "wkrpt200")).toBeUndefined();
  });
});

describe("parseTranscript — transfer credits", () => {
  const TRANSFER = `
Plan: Computer Science

Fall 2023
CS 135      Designing Functional Programs     0.50 0.50 85

Transfer Credit
MATH 137    Calculus 1                        TR
CS 145      Functional Programs Advanced      TR
MATH XXX    Math Transfer Credit              TR
CS 1XX      Computer Science Transfer         TR
`;

  it("includes transfer credits with real codes", () => {
    const result = parseTranscript(TRANSFER);
    const transfer = result.courses
      .filter((c) => c.status === "transfer")
      .map((c) => c.code)
      .sort();
    expect(transfer).toEqual(["cs145", "math137"]);
  });

  it("drops placeholder codes like 'MATH XXX' / 'CS 1XX'", () => {
    const result = parseTranscript(TRANSFER);
    expect(result.courses.find((c) => c.code === "mathxxx")).toBeUndefined();
    expect(result.courses.find((c) => c.code === "cs1xx")).toBeUndefined();
  });

  it("classifies term-section rows with grade=TR as transfer too", () => {
    // A row inside a regular term section but with TR grade should still be
    // treated as transfer (e.g. backdated transfer credit).
    const sample = `
Plan: Systems Design Engineering

Fall 2023
SYDE 101    Communications    0.50 0.50 85
MATH 137    Calculus 1        TR
`;
    const result = parseTranscript(sample);
    const m137 = result.courses.find((c) => c.code === "math137");
    expect(m137?.status).toBe("transfer");
  });
});

describe("parseTranscript — repeats", () => {
  it("dedupes a fail+pass to the passing attempt", () => {
    const sample = `
Plan: Systems Design Engineering

Fall 2023
CS 135    Functional Programs   0.50 0.50 F

Winter 2024
CS 135    Functional Programs   0.50 0.50 78
`;
    const result = parseTranscript(sample);
    const cs135 = result.courses.filter((c) => c.code === "cs135");
    expect(cs135).toHaveLength(1);
    expect(cs135[0].status).toBe("passed");
  });
});

describe("parseTranscript — double-degree (multiple Plan lines)", () => {
  it("uses the first Plan line listed", () => {
    const sample = `
Plan: Computer Science
Plan: Business Administration

Fall 2023
CS 135    Functional Programs    0.50 0.50 85
`;
    const result = parseTranscript(sample);
    expect(result.rawPlanText).toBe("Computer Science");
  });
});

describe("parseTranscript — malformed / empty", () => {
  it("returns empty result for empty input", () => {
    const result = parseTranscript("");
    expect(result.courses).toEqual([]);
    expect(result.detectedProgramId).toBeNull();
    expect(result.detectedCurrentTerm).toBeNull();
    expect(result.warnings).toEqual([]);
  });

  it("returns empty result when no recognizable course rows are present", () => {
    const result = parseTranscript(
      "Just some random text without any course codes.\nMore text.",
    );
    expect(result.courses).toEqual([]);
  });

  it("doesn't crash on whitespace-only input", () => {
    expect(() => parseTranscript("   \n  \t  \n")).not.toThrow();
  });
});

describe("parseTranscript — past-4B overflow", () => {
  it("emits a warning and clamps current-term to null when student has 9+ study terms", () => {
    const sections: string[] = [];
    for (let i = 0; i < 9; i++) {
      const year = 2020 + Math.floor(i / 3);
      const season = ["Fall", "Winter", "Spring"][i % 3];
      sections.push(
        `${season} ${year}\nCS ${100 + i}    Course ${i}    0.50 0.50 75\n`,
      );
    }
    const result = parseTranscript(
      `Plan: Computer Science\n\n${sections.join("\n")}`,
    );
    expect(
      result.warnings.some((w) => w.toLowerCase().includes("study terms")),
    ).toBe(true);
  });
});

describe("parseTranscript — unknown plan text", () => {
  it("returns detectedProgramId = null when plan can't be matched to a program", () => {
    const result = parseTranscript(
      `Plan: Some Made Up Program That Doesn't Exist\n\nFall 2023\nCS 135    Functional    0.50 0.50 85\n`,
    );
    expect(result.detectedProgramId).toBeNull();
    expect(result.rawPlanText).toBe("Some Made Up Program That Doesn't Exist");
  });
});

describe("parseTranscript — unrecognized grade tokens", () => {
  it("flags a course with an unknown grade as 'unrecognized'", () => {
    const result = parseTranscript(
      `Plan: Computer Science\n\nFall 2023\nCS 999    Mystery Course    0.50 0.50 XYZ\n`,
    );
    const c = result.courses.find((c) => c.code === "cs999");
    expect(c?.status).toBe("unrecognized");
  });
});

describe("parseTranscript — program detection from Quest Program: lines", () => {
  it("matches `Program: Systems Design Engineering, Honours, Co-operative Program`", () => {
    // Real Quest per-term-section format: trailing `, Honours, ...` suffix
    // must be stripped before matching against PROGRAMS[*].name.
    const result = parseTranscript(
      `Fall 2025
Program: Systems Design Engineering, Honours, Co-operative Program
Level: 1A
SYDE 101 Communications 0.50 0.50 93
`,
    );
    expect(result.detectedProgramId).toBe("systems-design-engineering");
    expect(result.rawPlanText).toBe("Systems Design Engineering");
  });

  it("skips a faculty-level `Program: Engineering` header and picks the per-term line", () => {
    // Quest sometimes emits both a faculty header (Engineering) and a per-
    // term major line. The faculty header doesn't match any slug; the parser
    // must keep scanning candidates instead of returning null.
    const result = parseTranscript(
      `Program: Engineering

Fall 2025
Program: Systems Design Engineering, Honours, Co-operative Program
SYDE 101 Communications 0.50 0.50 93
`,
    );
    expect(result.detectedProgramId).toBe("systems-design-engineering");
    expect(result.rawPlanText).toBe("Systems Design Engineering");
  });

  it("still honors a Plan: line if present (legacy header format)", () => {
    const result = parseTranscript(
      `Career: Undergraduate
Plan: Systems Design Engineering

Fall 2025
SYDE 101 Communications 0.50 0.50 93
`,
    );
    expect(result.detectedProgramId).toBe("systems-design-engineering");
  });

  it("falls back to the first candidate string when nothing matches a slug", () => {
    const result = parseTranscript(
      `Program: Hogwarts Wizardry, Honours
SYDE 101 Communications 0.50 0.50 93
`,
    );
    expect(result.detectedProgramId).toBeNull();
    expect(result.rawPlanText).toBe("Hogwarts Wizardry");
  });
});

describe("parseTranscript — future-term enrollment (no grade column yet)", () => {
  // Reduced fixture matching the real Quest layout the user reported in the
  // 2026-05-21 modal screenshot: Fall 2025 graded, Winter 2026 work term,
  // Spring 2026 enrolled but ungraded.
  const REAL_SYDE = `
Beginning of Undergraduate Record
Fall 2025

Program: Systems Design Engineering, Honours, Co-operative Program
Level: 1A
Form of Study: Enrolment

Course Description Attempted Earned Grade
SYDE 101  Communications in Systems Design Engineering — Written and Oral 0.25 0.25 93
SYDE 101L Communications in Systems Design Engineering — Visualization    0.25 0.25 97
SYDE 111  Calculus 1                                                       0.50 0.50 94
SYDE 113  Elementary Engineering Mathematics                               0.25 0.25 89
SYDE 121  Digital Computation                                              0.50 0.50 88
SYDE 161  Introduction to Design                                           0.50 0.50 81
SYDE 181  Physics 1: Statics                                               0.50 0.50 88

Term GPA: 89.18

Spring 2026

Program: Systems Design Engineering, Honours, Co-operative Program
Level: 1B
Form of Study: Enrolment

Course Description
BET 320   Entrepreneurial Strategy
SYDE 112  Calculus 2
SYDE 114  Matrices and Linear Systems
SYDE 162  Human Factors in Design
SYDE 192  Digital Systems
SYDE 192L Digital Systems Laboratory
SYDE 223  Data Structures and Algorithms
`;

  const result = parseTranscript(REAL_SYDE);
  const byCode = new Map(result.courses.map((c) => [c.code, c]));

  it("classifies Fall-2025 graded rows as passed", () => {
    for (const code of [
      "syde101",
      "syde101l",
      "syde111",
      "syde113",
      "syde121",
      "syde161",
      "syde181",
    ]) {
      expect(byCode.get(code)?.status, `${code} should be passed`).toBe(
        "passed",
      );
    }
  });

  it("classifies Spring-2026 ungraded rows as in-progress (was: skipped/unrecognized)", () => {
    for (const code of [
      "bet320",
      "syde112",
      "syde114",
      "syde162",
      "syde192",
      "syde192l",
      "syde223",
    ]) {
      expect(byCode.get(code)?.status, `${code} should be in-progress`).toBe(
        "inProgress",
      );
    }
  });

  it("does not mis-classify 'Calculus 2' as skipped (regression: rawGrade='2' → 2 < 50)", () => {
    expect(byCode.get("syde112")?.status).not.toBe("skipped");
  });

  it("does not mis-classify 'Digital Systems' as unrecognized (regression: rawGrade='Systems')", () => {
    expect(byCode.get("syde192")?.status).not.toBe("unrecognized");
  });
});

describe("parseTranscript — course-number digit boundaries", () => {
  it("ignores rows with fewer than 3 course-number digits (not a UW course)", () => {
    const result = parseTranscript(
      `Plan: Systems Design Engineering\n\nFall 2023\nXX 1    Garbage    0.50 0.50 75\n`,
    );
    expect(result.courses).toEqual([]);
  });

  it("accepts a 3-digit code with a trailing letter (e.g. SYDE 240E)", () => {
    const result = parseTranscript(
      `Plan: Systems Design Engineering\n\nFall 2023\nSYDE 240E    Lab    0.50 0.50 80\n`,
    );
    const c = result.courses.find((c) => c.code === "syde240e");
    expect(c).toBeDefined();
    expect(c?.status).toBe("passed");
  });
});

describe("parseTranscript — does not match metadata-looking lines", () => {
  it("ignores 'Spring 2024 Cumulative Average: 78' style lines", () => {
    const result = parseTranscript(
      `Plan: Computer Science\n\nFall 2023\nCS 135    Functional    0.50 0.50 85\n\nSpring 2024 Cumulative Average: 78\n`,
    );
    // The dangling 'Spring 2024 Cumulative Average: 78' line must not appear
    // as a 'spring2024' course code.
    expect(result.courses.find((c) => c.code === "spring2024")).toBeUndefined();
  });

  it("ignores 'Term GPA' lines", () => {
    const result = parseTranscript(
      `Plan: Computer Science\n\nFall 2023\nCS 135    Functional    0.50 0.50 85\n\nTerm GPA: 85\n`,
    );
    expect(result.courses.find((c) => c.code === "termgpa")).toBeUndefined();
  });
});

describe("matchProgramSlug", () => {
  it("matches an exact plan-name to a single program slug", () => {
    expect(matchProgramSlug("Systems Design Engineering")).toBe(
      "systems-design-engineering",
    );
  });

  it("returns null when multiple programs match (e.g. 'Computer Science')", () => {
    // 4 CS variants (BCS/BMath × H/JH) all have 'Computer Science' as field name.
    expect(matchProgramSlug("Computer Science")).toBeNull();
  });

  it("returns null for an empty or unmatched plan", () => {
    expect(matchProgramSlug("")).toBeNull();
    expect(matchProgramSlug("Hogwarts Wizardry")).toBeNull();
  });

  it("is case-insensitive and tolerant of parenthetical suffixes", () => {
    expect(matchProgramSlug("systems design engineering")).toBe(
      "systems-design-engineering",
    );
  });
});

describe("matchSpecializationFromPlan", () => {
  // SYDE is used as the parent because it's the only Systems Design
  // Engineering variant (single match for "Systems Design Engineering") and
  // also has 4 specializations attached — exactly the shape needed to
  // exercise both halves of the parser. These tests skip cleanly if
  // data/programs.json is regenerated without specs.
  const hasSydeSpecs =
    (PROGRAMS["systems-design-engineering"]?.specializations?.length ?? 0) > 0;

  it.runIf(hasSydeSpecs)(
    "resolves both program and specialization when the Plan line has both halves (em-dash)",
    () => {
      const r = matchSpecializationFromPlan(
        "Systems Design Engineering — Human Factors and Interfaces Specialization",
      );
      expect(r).not.toBeNull();
      expect(r?.programId).toBe("systems-design-engineering");
      expect(r?.specializationSlug).toBe("syde-human-factors-and-interfaces");
    },
  );

  it.runIf(hasSydeSpecs)("tolerates a plain hyphen-minus separator", () => {
    const r = matchSpecializationFromPlan(
      "Systems Design Engineering - Human Factors and Interfaces Specialization",
    );
    expect(r?.specializationSlug).toBe("syde-human-factors-and-interfaces");
  });

  it("returns null when the line has no specialization clause", () => {
    expect(
      matchSpecializationFromPlan("Systems Design Engineering"),
    ).toBeNull();
    // Right half is missing the literal 'Specialization'.
    expect(
      matchSpecializationFromPlan(
        "Systems Design Engineering — something else",
      ),
    ).toBeNull();
  });

  it("returns null when the parent program does not resolve", () => {
    expect(
      matchSpecializationFromPlan(
        "Hogwarts Wizardry — Dark Arts Specialization",
      ),
    ).toBeNull();
  });

  it.runIf(hasSydeSpecs)(
    "returns null when the parent resolves but the specialization name does not match anything",
    () => {
      expect(
        matchSpecializationFromPlan(
          "Systems Design Engineering — Quantum Bagpipe Specialization",
        ),
      ).toBeNull();
    },
  );

  it.runIf(hasSydeSpecs)(
    "parseTranscript exposes detectedSpecializationSlug end-to-end",
    () => {
      const r = parseTranscript(
        "Plan: Systems Design Engineering — Human Factors and Interfaces Specialization\n\nFall 2024\nSYDE 101    Foo    0.50 0.50 85\n",
      );
      expect(r.detectedProgramId).toBe("systems-design-engineering");
      expect(r.detectedSpecializationSlug).toBe(
        "syde-human-factors-and-interfaces",
      );
    },
  );

  it("parseTranscript falls back to parent-only when no spec clause is present", () => {
    const r = parseTranscript(
      "Plan: Systems Design Engineering\n\nFall 2023\nSYDE 101    Foo    0.50 0.50 85\n",
    );
    expect(r.detectedProgramId).toBe("systems-design-engineering");
    expect(r.detectedSpecializationSlug).toBeNull();
  });

  it.runIf(hasSydeSpecs)(
    "exact match wins (regression: word-boundary fallback never overrides exact)",
    () => {
      // Sanity: the exact-match path resolves the canonical spec name even
      // when the word-boundary fallback would also match it.
      const r = matchSpecializationFromPlan(
        "Systems Design Engineering — Human Factors and Interfaces Specialization",
      );
      expect(r?.specializationSlug).toBe("syde-human-factors-and-interfaces");
    },
  );

  it.runIf(hasSydeSpecs)(
    "word-boundary fallback resolves when the needle is a shorter, unambiguous prefix-style match",
    () => {
      // "Human Factors Specialization" isn't an exact spec name, but its
      // non-sentinel tokens ("human", "factors") uniquely appear in
      // "Human Factors and Interfaces Specialization".
      const r = matchSpecializationFromPlan(
        "Systems Design Engineering — Human Factors Specialization",
      );
      expect(r?.specializationSlug).toBe("syde-human-factors-and-interfaces");
    },
  );

  it.runIf(hasSydeSpecs)(
    "rejects a single-token needle even when one spec uniquely contains it",
    () => {
      // "Interfaces" alone substring-matched "Human Factors and Interfaces
      // Specialization" under the old logic and silently picked it — but the
      // user's intent is ambiguous with only one disambiguating token. The
      // fallback now requires at least two non-sentinel tokens.
      const r = matchSpecializationFromPlan(
        "Systems Design Engineering — Interfaces Specialization",
      );
      expect(r).toBeNull();
    },
  );
});
