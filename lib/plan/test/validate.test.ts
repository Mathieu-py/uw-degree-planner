import { describe, expect, it } from "vitest";
import type { Course } from "@/lib/courses/types";
import type { PrereqNode } from "@/lib/prereqs/parse";
import type { LocalPlan } from "../types";
import {
  ACADEMIC_TERM_CAP,
  issuesByCourseInSlot,
  resolveAntireqCodes,
  validatePlan,
} from "../validate";

function mkCourse(
  code: string,
  opts: {
    prereqs?: string;
    coreqs?: string;
    antireqs?: string;
    antireqCodes?: string[];
    prereqAst?: PrereqNode;
    crossListed?: string[];
  } = {},
): Course {
  return {
    id: 0,
    code,
    name: code,
    prereqs: opts.prereqs ?? null,
    coreqs: opts.coreqs ?? null,
    antireqs: opts.antireqs ?? null,
    ...(opts.antireqCodes ? { antireqCodes: opts.antireqCodes } : {}),
    ...(opts.prereqAst ? { prereqAst: opts.prereqAst } : {}),
    ...(opts.crossListed ? { crossListed: opts.crossListed } : {}),
    rating: null,
    sections: [],
    prefix: code.replace(/\d.*$/, "").toUpperCase(),
    level: 100,
    hasSeats: false,
  };
}

function catalog(...courses: Course[]): Map<string, Course> {
  return new Map(courses.map((c) => [c.code, c]));
}

function mkPlan(
  slots: Array<{
    id: string;
    termId: number | null;
    isCoop?: boolean;
    position?: string;
    courses: string[];
  }>,
): LocalPlan {
  return {
    schemaVersion: 3,
    programIds: [],
    specializationIds: {},
    stream: "stream8",
    startTermId: 1239,
    slots: slots.map((s) => ({
      id: s.id,
      termId: s.termId,
      // biome-ignore lint/suspicious/noExplicitAny: test fixtures use freeform positions
      position: (s.position ?? (s.isCoop ? "coop1" : "1A")) as any,
      isCoop: s.isCoop ?? false,
      courses: s.courses.map((c) => ({ code: c })),
    })),
    updatedAt: "2026-05-23T12:00:00.000Z",
  };
}

describe("resolveAntireqCodes", () => {
  it("prefers structured antireqCodes over the free-text antireqs", () => {
    const c = mkCourse("cs246", {
      antireqs: "CS 247", // stale prose
      antireqCodes: ["cs246e"], // authoritative Kuali
    });
    expect(resolveAntireqCodes(c)).toEqual(["cs246e"]);
  });
  it("falls back to the prose regex when no structured codes", () => {
    const c = mkCourse("cs246", { antireqs: "CS 247, CS 248" });
    expect(resolveAntireqCodes(c)).toEqual(["cs247", "cs248"]);
  });
  it("returns [] when the course has neither", () => {
    expect(resolveAntireqCodes(mkCourse("cs246"))).toEqual([]);
  });
});

describe("validatePlan — antireq sourced from Kuali codes", () => {
  it("flags a conflict from structured antireqCodes even with no prose", () => {
    const cat = catalog(
      mkCourse("cs246", { antireqCodes: ["cs246e"] }), // no antireqs string
      mkCourse("cs246e"),
    );
    const plan = mkPlan([
      { id: "s1", termId: 1239, courses: ["cs246", "cs246e"] },
    ]);
    const issues = validatePlan(plan, cat);
    const antireq = issues.filter((i) => i.kind === "antireq");
    expect(antireq.length).toBeGreaterThan(0);
    expect(antireq.some((i) => i.conflictsWith?.includes("cs246e"))).toBe(true);
  });
});

describe("validatePlan — prereq", () => {
  it("flags a course whose prereq is not in the plan", () => {
    const cat = catalog(
      mkCourse("cs246", { prereqs: "CS 136" }),
      mkCourse("cs136"),
    );
    const plan = mkPlan([
      { id: "s1", termId: 1239, courses: ["cs246"] }, // missing cs136
    ]);
    const issues = validatePlan(plan, cat);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("prereq");
    expect(issues[0].courseCode).toBe("cs246");
    expect(issues[0].message).toContain("CS 136");
  });

  it("does not flag when prereq is placed in an earlier slot", () => {
    const cat = catalog(
      mkCourse("cs246", { prereqs: "CS 136" }),
      mkCourse("cs136"),
    );
    const plan = mkPlan([
      { id: "s1", termId: 1239, courses: ["cs136"] },
      { id: "s2", termId: 1241, courses: ["cs246"] },
    ]);
    expect(validatePlan(plan, cat)).toEqual([]);
  });

  it("DOES flag when prereq is placed in the SAME slot (prereqs must be earlier)", () => {
    const cat = catalog(
      mkCourse("cs246", { prereqs: "CS 136" }),
      mkCourse("cs136"),
    );
    const plan = mkPlan([
      { id: "s1", termId: 1239, courses: ["cs136", "cs246"] },
    ]);
    const issues = validatePlan(plan, cat);
    expect(issues.map((i) => i.kind)).toEqual(["prereq"]);
  });
});

describe("validatePlan — coreqOf prereq (ACTSC 231)", () => {
  // STAT 220 OR a corequisite of STAT 230/240 — the corequisite path may be
  // satisfied by a same-term course, unlike an ordinary prereq.
  const actsc231 = (): Course =>
    mkCourse("actsc231", {
      prereqAst: {
        kind: "or",
        children: [
          { kind: "course", code: "stat220" },
          {
            kind: "coreqOf",
            child: {
              kind: "or",
              children: [
                { kind: "course", code: "stat230" },
                { kind: "course", code: "stat240" },
              ],
            },
          },
        ],
      },
    });

  it("is satisfied by the corequisite taken in the SAME term", () => {
    const cat = catalog(actsc231(), mkCourse("stat230"));
    const plan = mkPlan([
      { id: "s1", termId: 1239, courses: ["actsc231", "stat230"] },
    ]);
    expect(validatePlan(plan, cat)).toEqual([]);
  });

  it("is satisfied by the STAT 220 prereq taken in an earlier term", () => {
    const cat = catalog(actsc231(), mkCourse("stat220"));
    const plan = mkPlan([
      { id: "s1", termId: 1239, courses: ["stat220"] },
      { id: "s2", termId: 1241, courses: ["actsc231"] },
    ]);
    expect(validatePlan(plan, cat)).toEqual([]);
  });

  it("flags STAT 220 + the coreq option when neither route is taken", () => {
    const cat = catalog(actsc231());
    const plan = mkPlan([{ id: "s1", termId: 1239, courses: ["actsc231"] }]);
    const issues = validatePlan(plan, cat);
    expect(issues.map((i) => i.kind)).toEqual(["prereq"]);
    // No longer swallowed: the coreq path is inlined, so the message lists
    // STAT 220 alongside the corequisite courses as one flat choice.
    expect(issues[0].message).toContain("STAT 220");
    expect(issues[0].message).toContain("STAT 230");
    expect(issues[0].message).toContain("STAT 240");
  });
});

describe("validatePlan — antireq", () => {
  it("flags a course whose antireq is placed anywhere in the plan", () => {
    const cat = catalog(
      mkCourse("math115", { antireqs: "MATH 117" }),
      mkCourse("math117", { antireqs: "MATH 115" }),
    );
    const plan = mkPlan([
      { id: "s1", termId: 1239, courses: ["math115"] },
      { id: "s2", termId: 1241, courses: ["math117"] },
    ]);
    const issues = validatePlan(plan, cat);
    expect(issues.map((i) => i.kind)).toEqual(["antireq", "antireq"]);
    const m115 = issues.find((i) => i.courseCode === "math115");
    expect(m115?.message).toContain("MATH 117");
  });

  it("flags BOTH courses symmetrically when only one names the other", () => {
    // UW credit rule: "credit will not be granted for both the antirequisite
    // course and a course naming it as such." CS 115 names ECE 150 but ECE 150
    // does not name CS 115 — both must still be flagged.
    const cat = catalog(
      mkCourse("cs115", { antireqs: "ECE 150" }),
      mkCourse("ece150", { antireqs: "CIVE 121" }),
    );
    const plan = mkPlan([
      { id: "s1", termId: 1239, courses: ["cs115"] },
      { id: "s2", termId: 1241, courses: ["ece150"] },
    ]);
    const issues = validatePlan(plan, cat);
    expect(issues.map((i) => i.kind)).toEqual(["antireq", "antireq"]);
    expect(issues.find((i) => i.courseCode === "cs115")?.message).toContain(
      "ECE 150",
    );
    expect(issues.find((i) => i.courseCode === "ece150")?.message).toContain(
      "CS 115",
    );
    // Structured conflict members let the audit group the pair into one set.
    expect(issues.find((i) => i.courseCode === "cs115")?.conflictsWith).toEqual(
      ["ece150"],
    );
    expect(
      issues.find((i) => i.courseCode === "ece150")?.conflictsWith,
    ).toEqual(["cs115"]);
  });

  it("does not flag a course's antireq list against itself", () => {
    const cat = catalog(
      mkCourse("cs115", { antireqs: "CS 115 (?)" }), // self-reference (malformed; should not flag)
    );
    const plan = mkPlan([{ id: "s1", termId: 1239, courses: ["cs115"] }]);
    expect(validatePlan(plan, cat)).toEqual([]);
  });
});

describe("validatePlan — coreq", () => {
  it("does not flag a coreq satisfied by same-slot placement", () => {
    const cat = catalog(
      mkCourse("syde101", { coreqs: "SYDE 101L" }),
      mkCourse("syde101l"),
    );
    const plan = mkPlan([
      { id: "s1", termId: 1239, courses: ["syde101", "syde101l"] },
    ]);
    expect(validatePlan(plan, cat)).toEqual([]);
  });

  it("does not flag a coreq satisfied by a previous slot", () => {
    const cat = catalog(
      mkCourse("syde101", { coreqs: "SYDE 101L" }),
      mkCourse("syde101l"),
    );
    const plan = mkPlan([
      { id: "s1", termId: 1239, courses: ["syde101l"] },
      { id: "s2", termId: 1241, courses: ["syde101"] },
    ]);
    expect(validatePlan(plan, cat)).toEqual([]);
  });

  it("flags a missing coreq", () => {
    const cat = catalog(
      mkCourse("syde101", { coreqs: "SYDE 101L" }),
      mkCourse("syde101l"),
    );
    const plan = mkPlan([{ id: "s1", termId: 1239, courses: ["syde101"] }]);
    const issues = validatePlan(plan, cat);
    expect(issues.map((i) => i.kind)).toEqual(["coreq"]);
  });
});

describe("validatePlan — overload", () => {
  it("flags an academic slot over the cap", () => {
    const cat = catalog(
      mkCourse("a"),
      mkCourse("b"),
      mkCourse("c"),
      mkCourse("d"),
      mkCourse("e"),
      mkCourse("f"),
      mkCourse("g"),
    );
    const plan = mkPlan([
      {
        id: "s1",
        termId: 1239,
        courses: ["a", "b", "c", "d", "e", "f", "g"],
      },
    ]);
    const issues = validatePlan(plan, cat);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("overload");
    expect(issues[0].slotId).toBe("s1");
    expect(issues[0].message).toContain(`cap ${ACADEMIC_TERM_CAP}`);
  });

  it("does not flag a slot at the cap", () => {
    const cat = catalog(
      mkCourse("a"),
      mkCourse("b"),
      mkCourse("c"),
      mkCourse("d"),
      mkCourse("e"),
      mkCourse("f"),
    );
    const plan = mkPlan([
      {
        id: "s1",
        termId: 1239,
        courses: ["a", "b", "c", "d", "e", "f"],
      },
    ]);
    expect(validatePlan(plan, cat)).toEqual([]);
  });
});

describe("validatePlan — co-op slots", () => {
  it("skips co-op slots entirely", () => {
    const cat = catalog(mkCourse("cs246", { prereqs: "CS 136" }));
    const plan = mkPlan([
      { id: "s1", termId: 1245, isCoop: true, courses: ["cs246"] },
    ]);
    expect(validatePlan(plan, cat)).toEqual([]);
  });
});

describe("validatePlan — uncertain prereqs", () => {
  it("does not flag a genuinely uncertain prereq (raw 'Permission of instructor')", () => {
    // Raw/program clauses resolve to "uncertain" (not a definite miss), so they
    // must not raise an issue. (Level gates, by contrast, ARE flagged against the
    // slot's level — see the "level" suite.)
    const cat = catalog(
      mkCourse("cs246", { prereqs: "Permission of instructor" }),
    );
    const plan = mkPlan([{ id: "s1", termId: 1239, courses: ["cs246"] }]);
    expect(validatePlan(plan, cat)).toEqual([]);
  });
});

describe("validatePlan — pre slot", () => {
  it("skips validation for slots with position='pre'", () => {
    // Transfer credits sit in the pre slot. Even if they'd otherwise trip an
    // antireq against an academic slot, the pre slot itself must not raise
    // per-course issues.
    const cat = catalog(
      mkCourse("cs246", { prereqs: "CS 136" }),
      mkCourse("cs136"),
    );
    const plan = mkPlan([
      { id: "pre", termId: null, position: "pre", courses: ["cs246"] },
    ]);
    expect(validatePlan(plan, cat)).toEqual([]);
  });
});

describe("validatePlan — catalog miss", () => {
  it("ignores codes not in the catalog", () => {
    // No "weirdcourse" in the catalog → silently skipped, no issue raised.
    const cat = catalog(mkCourse("cs115"));
    const plan = mkPlan([
      { id: "s1", termId: 1239, courses: ["cs115", "weirdcourse"] },
    ]);
    expect(validatePlan(plan, cat)).toEqual([]);
  });
});

describe("issuesByCourseInSlot", () => {
  it("partitions per-course issues from slot-level issues", () => {
    const slotIssues = [
      {
        slotId: "s1",
        courseCode: "cs246",
        kind: "prereq" as const,
        message: "x",
      },
      { slotId: "s1", courseCode: "", kind: "overload" as const, message: "y" },
      {
        slotId: "s1",
        courseCode: "cs246",
        kind: "antireq" as const,
        message: "z",
      },
    ];
    const { byCourse, slotLevel } = issuesByCourseInSlot(slotIssues);
    expect(byCourse.get("cs246")?.map((i) => i.kind)).toEqual([
      "prereq",
      "antireq",
    ]);
    expect(slotLevel.map((i) => i.kind)).toEqual(["overload"]);
  });
});

describe("validatePlan — level", () => {
  it("flags a course placed in a term below its required level", () => {
    const cat = catalog(mkCourse("cs492", { prereqs: "Level at least 3A" }));
    const plan = mkPlan([
      { id: "s1", termId: 1239, position: "1A", courses: ["cs492"] },
    ]);
    const level = validatePlan(plan, cat).filter((i) => i.kind === "level");
    expect(level).toHaveLength(1);
    expect(level[0].courseCode).toBe("cs492");
    expect(level[0].message).toContain("3A");
  });

  it("does not flag when the term meets the level", () => {
    const cat = catalog(mkCourse("cs492", { prereqs: "Level at least 3A" }));
    const plan = mkPlan([
      { id: "s1", termId: 1259, position: "3A", courses: ["cs492"] },
    ]);
    expect(validatePlan(plan, cat).some((i) => i.kind === "level")).toBe(false);
  });

  it("emits a level badge separate from a missing-course prereq", () => {
    const cat = catalog(
      mkCourse("cs492", { prereqs: "CS 246; Level at least 3A" }),
      mkCourse("cs246"),
    );
    const plan = mkPlan([
      { id: "s1", termId: 1239, position: "1A", courses: ["cs492"] }, // cs246 missing + too low
    ]);
    const kinds = validatePlan(plan, cat)
      .filter((i) => i.courseCode === "cs492")
      .map((i) => i.kind)
      .sort();
    expect(kinds).toEqual(["level", "prereq"]);
  });

  it("does not flag a level gate that is only one OR alternative", () => {
    // FINE 209-style: "VCULT 101 or Level at least 2A" — taking VCULT 101
    // satisfies the prereq with NO level requirement, so a 1A placement gets a
    // prereq badge (listing the open routes) but never a hard level badge.
    const cat = catalog(
      mkCourse("fine209", { prereqs: "VCULT 101 or Level at least 2A" }),
      mkCourse("vcult101"),
    );
    const plan = mkPlan([
      { id: "s1", termId: 1239, position: "1A", courses: ["fine209"] },
    ]);
    const issues = validatePlan(plan, cat);
    expect(issues.some((i) => i.kind === "level")).toBe(false);
    expect(issues.some((i) => i.kind === "prereq")).toBe(true);
  });

  it("does not flag the level branch of a satisfied-with-uncertainty OR", () => {
    // or(level 2A, program restriction): with no program identity the OR
    // biases to satisfied+uncertain — its failed level branch must not leak
    // into a hard badge (regression: the old rawRequirements string scan did).
    const cat = catalog(
      mkCourse("blkst202", {
        prereqAst: {
          kind: "or",
          children: [
            { kind: "level", minLevel: "2A" },
            { kind: "program", clause: "Black Studies students only" },
          ],
        },
      }),
    );
    const plan = mkPlan([
      { id: "s1", termId: 1239, position: "1A", courses: ["blkst202"] },
    ]);
    expect(validatePlan(plan, cat)).toEqual([]);
  });

  it("flags the binding gate of an OR whose every branch is level-gated", () => {
    // or(level 3A, level 2A): some level is unavoidable — the laxest binds.
    const cat = catalog(
      mkCourse("x300", {
        prereqAst: {
          kind: "or",
          children: [
            { kind: "level", minLevel: "3A" },
            { kind: "level", minLevel: "2A" },
          ],
        },
      }),
    );
    const plan = mkPlan([
      { id: "s1", termId: 1239, position: "1A", courses: ["x300"] },
    ]);
    const level = validatePlan(plan, cat).filter((i) => i.kind === "level");
    expect(level).toHaveLength(1);
    expect(level[0].message).toContain("2A");
  });
});

describe("validatePlan — cross-listed twins (#21)", () => {
  const amath242 = () => mkCourse("amath242", { crossListed: ["cs371"] });
  const cs371 = () => mkCourse("cs371", { crossListed: ["amath242"] });

  it("flags a plan holding BOTH members of a cross-listed pair", () => {
    // They're the same course — both placed means its units would credit
    // twice. Surfaced with the antireq kind so creditExclusionKeys holds one
    // member out of credit.
    const cat = catalog(amath242(), cs371());
    const plan = mkPlan([
      { id: "s1", termId: 1239, courses: ["amath242"] },
      { id: "s2", termId: 1241, courses: ["cs371"] },
    ]);
    const issues = validatePlan(plan, cat);
    expect(issues.map((i) => i.kind)).toEqual(["antireq", "antireq"]);
    expect(
      issues.find((i) => i.courseCode === "amath242")?.conflictsWith,
    ).toEqual(["cs371"]);
    expect(issues.find((i) => i.courseCode === "cs371")?.conflictsWith).toEqual(
      ["amath242"],
    );
    expect(issues[0].message).toContain("cross-listed");
  });

  it("does not flag a lone member of a cross-listed pair", () => {
    const cat = catalog(amath242(), cs371());
    const plan = mkPlan([{ id: "s1", termId: 1239, courses: ["cs371"] }]);
    expect(validatePlan(plan, cat)).toEqual([]);
  });

  it("matches a named antireq through the placed cross-listed twin", () => {
    // ACTSC 221 names CIVE 392 but not its twins; the plan holds ENVE 392.
    // Both directions must flag (same conflict, one set).
    const cat = catalog(
      mkCourse("actsc221", { antireqCodes: ["cive392"] }),
      mkCourse("cive392", { crossListed: ["enve392"] }),
      mkCourse("enve392", { crossListed: ["cive392"] }),
    );
    const plan = mkPlan([
      { id: "s1", termId: 1239, courses: ["actsc221"] },
      { id: "s2", termId: 1241, courses: ["enve392"] },
    ]);
    const issues = validatePlan(plan, cat);
    expect(issues.map((i) => i.kind)).toEqual(["antireq", "antireq"]);
    expect(
      issues.find((i) => i.courseCode === "actsc221")?.conflictsWith,
    ).toEqual(["enve392"]);
    expect(
      issues.find((i) => i.courseCode === "enve392")?.conflictsWith,
    ).toEqual(["actsc221"]);
  });

  it("satisfies a coreq with a co-scheduled cross-listed twin", () => {
    // PHYS 121's coreq names ECE 205; the student co-schedules its twin
    // MATH 211 — same course, same term, no badge (it already passed one term
    // earlier via the expanded completed set; same-term must agree).
    const cat = catalog(
      mkCourse("phys121", { coreqs: "ECE 205" }),
      mkCourse("ece205", { crossListed: ["math211"] }),
      mkCourse("math211", { crossListed: ["ece205"] }),
    );
    const plan = mkPlan([
      { id: "s1", termId: 1239, courses: ["phys121", "math211"] },
    ]);
    expect(validatePlan(plan, cat)).toEqual([]);
  });
});
