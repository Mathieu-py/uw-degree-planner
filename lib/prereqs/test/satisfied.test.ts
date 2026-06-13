import { describe, expect, it } from "vitest";
import type { ProgramIdentity } from "@/lib/programs";
import { type PrereqNode, parsePrereqs } from "../parse";
import { evaluate } from "../satisfied";

function user(completed: string[], level?: string) {
  return { completed: new Set(completed), level };
}

const SYDE: ProgramIdentity = {
  programId: "systems-design-engineering",
  names: ["systems design engineering", "syde"],
  faculty: "engineering",
};

const ANTHRO: ProgramIdentity = {
  programId: "anthropology",
  names: ["anthropology"],
  faculty: "arts",
};

const MATH: ProgramIdentity = {
  programId: "honours-mathematics",
  names: ["honours mathematics", "mathematics"],
  faculty: "mathematics",
};

const UNKNOWN_FAC: ProgramIdentity = {
  programId: "mystery-program",
  names: ["mystery program"],
  faculty: null,
};

describe("evaluate", () => {
  it("satisfies an empty prereq", () => {
    const result = evaluate(parsePrereqs(""), user([]));
    expect(result.satisfied).toBe(true);
  });

  it("requires a single course to be completed", () => {
    const node = parsePrereqs("MATH116");
    expect(evaluate(node, user([])).satisfied).toBe(false);
    expect(evaluate(node, user(["math116"])).satisfied).toBe(true);
  });

  it("OR — any one course is enough", () => {
    const node = parsePrereqs("MATH116 or MATH117");
    expect(evaluate(node, user(["math117"])).satisfied).toBe(true);
    expect(evaluate(node, user(["math116"])).satisfied).toBe(true);
    expect(evaluate(node, user([])).satisfied).toBe(false);
  });

  it("AND — every course required", () => {
    const node = parsePrereqs("MATH116 and CO250");
    expect(evaluate(node, user(["math116"])).satisfied).toBe(false);
    expect(evaluate(node, user(["math116", "co250"])).satisfied).toBe(true);
  });

  it("'one of' — any one suffices", () => {
    const node = parsePrereqs("One of MATH118, MATH128, MATH138");
    expect(evaluate(node, user(["math138"])).satisfied).toBe(true);
    expect(evaluate(node, user([])).satisfied).toBe(false);
  });

  it("reports the missing course on failure", () => {
    const result = evaluate(
      parsePrereqs("MATH116 and CO250"),
      user(["math116"]),
    );
    expect(result.satisfied).toBe(false);
    expect(result.missingCourses).toEqual(["co250"]);
  });

  it("treats raw program text as uncertain", () => {
    const result = evaluate(
      parsePrereqs("MATH116; Honours Mathematics students only"),
      user(["math116"]),
    );
    expect(result.uncertain).toBe(true);
    expect(result.rawRequirements).toContain(
      "Honours Mathematics students only",
    );
  });

  it("level requirement passes when user level is high enough", () => {
    const node = parsePrereqs("Level at least 2A");
    expect(evaluate(node, user([], "2B")).satisfied).toBe(true);
    expect(evaluate(node, user([], "2A")).satisfied).toBe(true);
    expect(evaluate(node, user([], "1B")).satisfied).toBe(false);
  });

  it("level requirement is uncertain when user level unknown", () => {
    const result = evaluate(parsePrereqs("Level at least 2A"), user([]));
    expect(result.uncertain).toBe(true);
    expect(result.satisfied).toBe(true);
  });

  it("complex nested expression", () => {
    const node = parsePrereqs("(MATH116 or MATH117) and (CO250 or CO253)");
    expect(evaluate(node, user(["math117", "co253"])).satisfied).toBe(true);
    expect(evaluate(node, user(["math117"])).satisfied).toBe(false);
  });

  it("program restriction is a hard fail for the wrong program", () => {
    const node = parsePrereqs("Anthropology students only");
    const result = evaluate(node, { completed: new Set(), programs: [SYDE] });
    expect(result.satisfied).toBe(false);
    expect(result.uncertain).toBe(false);
    expect(result.missingCourses).toEqual([]);
    expect(result.rawRequirements).toEqual(["Anthropology students only"]);
  });

  it("program restriction passes for an allowed faculty", () => {
    const node = parsePrereqs("Open only to students in Engineering");
    const result = evaluate(node, { completed: new Set(), programs: [SYDE] });
    expect(result.satisfied).toBe(true);
    expect(result.uncertain).toBe(false);
  });

  it("double degree — passes if either program is allowed (most-permissive)", () => {
    const node = parsePrereqs("Anthropology students only");
    // SYDE alone blocks; with ANTHRO on the other side, the restriction passes.
    expect(
      evaluate(node, { completed: new Set(), programs: [SYDE] }).satisfied,
    ).toBe(false);
    const both = evaluate(node, {
      completed: new Set(),
      programs: [SYDE, ANTHRO],
    });
    expect(both.satisfied).toBe(true);
    expect(both.uncertain).toBe(false);
    expect(both.blockedByProgram).toBe(false);
  });

  it("double degree — blocks only when every program is blocked", () => {
    const node = parsePrereqs("Anthropology students only");
    const result = evaluate(node, {
      completed: new Set(),
      programs: [SYDE, SYDE],
    });
    expect(result.satisfied).toBe(false);
    expect(result.blockedByProgram).toBe(true);
  });

  // Negated/exclusion clauses merge MOST-RESTRICTIVELY across a double degree:
  // a student enrolled in the excluded faculty on *any* side is caught, even
  // though their other degree wouldn't be (UW Kuali requisite wording + the
  // "satisfy both faculties" double-degree rule). See satisfied.ts.
  it("negated restriction — single excluded faculty blocks", () => {
    const node = parsePrereqs("Not open to Faculty of Math students");
    const result = evaluate(node, { completed: new Set(), programs: [MATH] });
    expect(result.satisfied).toBe(false);
    expect(result.blockedByProgram).toBe(true);
  });

  it("negated restriction — non-excluded faculty is allowed", () => {
    const node = parsePrereqs("Not open to Faculty of Math students");
    const result = evaluate(node, { completed: new Set(), programs: [SYDE] });
    expect(result.satisfied).toBe(true);
    expect(result.uncertain).toBe(false);
  });

  it("double degree — one excluded faculty blocks despite a non-excluded side", () => {
    const node = parsePrereqs("Not open to Faculty of Math students");
    // Math + Engineering: the student IS a Faculty-of-Math student on one side,
    // so the exclusion applies — most-permissive would have wrongly allowed it.
    const result = evaluate(node, {
      completed: new Set(),
      programs: [SYDE, MATH],
    });
    expect(result.satisfied).toBe(false);
    expect(result.blockedByProgram).toBe(true);
  });

  it("double degree — neither side excluded is allowed", () => {
    const node = parsePrereqs("Not open to Faculty of Math students");
    const result = evaluate(node, {
      completed: new Set(),
      programs: [SYDE, ANTHRO],
    });
    expect(result.satisfied).toBe(true);
    expect(result.uncertain).toBe(false);
  });

  it("negated restriction — unknown faculty stays a check, never a confident allow", () => {
    const node = parsePrereqs("Not open to Faculty of Math students");
    const result = evaluate(node, {
      completed: new Set(),
      programs: [UNKNOWN_FAC],
    });
    expect(result.uncertain).toBe(true);
    expect(result.blockedByProgram).toBe(false);
  });

  it("suppressProgramBlock demotes a wrong-program block to an uncertain check", () => {
    const node = parsePrereqs("Anthropology students only");
    // Without suppression: a hard fail.
    const hard = evaluate(node, { completed: new Set(), programs: [SYDE] });
    expect(hard.satisfied).toBe(false);
    expect(hard.blockedByProgram).toBe(true);
    // With suppression (course is program-referenced): satisfied + uncertain,
    // and no longer attributed to a program block.
    const soft = evaluate(node, {
      completed: new Set(),
      programs: [SYDE],
      suppressProgramBlock: true,
    });
    expect(soft.satisfied).toBe(true);
    expect(soft.uncertain).toBe(true);
    expect(soft.blockedByProgram).toBe(false);
  });

  it("program restriction stays uncertain when the program is unknown", () => {
    const node = parsePrereqs("Anthropology students only");
    const result = evaluate(node, { completed: new Set() });
    expect(result.satisfied).toBe(true);
    expect(result.uncertain).toBe(true);
  });

  it("AND-combines a course prereq with a program gate", () => {
    const node = parsePrereqs("MATH116; Anthropology students only");
    // Course satisfied but wrong program → overall missing.
    const result = evaluate(node, {
      completed: new Set(["math116"]),
      programs: [SYDE],
    });
    expect(result.satisfied).toBe(false);
  });

  it("flags blockedByProgram only for a confirmed program restriction", () => {
    const blocked = evaluate(parsePrereqs("Anthropology students only"), {
      completed: new Set(),
      programs: [SYDE],
    });
    expect(blocked.blockedByProgram).toBe(true);

    // Unknown program → uncertain, not a confirmed block.
    const unknown = evaluate(parsePrereqs("Anthropology students only"), {
      completed: new Set(),
    });
    expect(unknown.blockedByProgram).toBe(false);
  });

  it("does not flag blockedByProgram for a level fail carrying trailing prose", () => {
    // "Level at least 3A and consent of instructor" below 3A is a level fail
    // with leftover raw prose — it must NOT be mistaken for a program block
    // (which would mislabel it "Wrong program" in the UI).
    const result = evaluate(
      parsePrereqs("Level at least 3A and consent of instructor"),
      { completed: new Set(["cs135"]), level: "1A" },
    );
    expect(result.satisfied).toBe(false);
    expect(result.blockedByProgram).toBe(false);
    // The level gate is still surfaced so the UI can name it.
    expect(result.rawRequirements).toContain("Level at least 3A");
  });

  it("surfaces the required level on a definite level fail", () => {
    const result = evaluate(parsePrereqs("Level at least 2A"), user([], "1B"));
    expect(result.satisfied).toBe(false);
    expect(result.rawRequirements).toEqual(["Level at least 2A"]);
  });
});

describe("evaluate — countOf (Kuali 'Complete N of')", () => {
  const c = (code: string): PrereqNode => ({ kind: "course", code });
  const countOf = (n: number, ...codes: string[]): PrereqNode => ({
    kind: "countOf",
    n,
    children: codes.map(c),
  });

  it("is satisfied when at least n children are definitely met", () => {
    const node = countOf(2, "a", "b", "cc");
    expect(evaluate(node, user(["a", "b"])).satisfied).toBe(true);
    expect(evaluate(node, user(["a", "b"])).uncertain).toBe(false);
    expect(evaluate(node, user(["a", "b", "cc"])).satisfied).toBe(true); // over
  });

  it("fails when fewer than n are met and none are uncertain", () => {
    const node = countOf(2, "a", "b", "cc");
    const r = evaluate(node, user(["a"]));
    expect(r.satisfied).toBe(false);
    // The unmet children's codes are surfaced as options.
    expect(r.missingCourses).toEqual(expect.arrayContaining(["b", "cc"]));
  });

  it("biases to satisfied+uncertain when uncertain children could reach n", () => {
    // 1 definite (a) + 1 uncertain (raw) can still reach n=2.
    const node: PrereqNode = {
      kind: "countOf",
      n: 2,
      children: [c("a"), c("b"), { kind: "raw", text: "instructor consent" }],
    };
    const r = evaluate(node, user(["a"]));
    expect(r.satisfied).toBe(true);
    expect(r.uncertain).toBe(true);
  });

  it("n=all behaves like AND; missing one fails", () => {
    const node = countOf(2, "a", "b");
    expect(evaluate(node, user(["a", "b"])).satisfied).toBe(true);
    expect(evaluate(node, user(["a"])).satisfied).toBe(false);
  });
});

describe("evaluate — coreqOf (corequisite satisfies a prereq, ACTSC 231)", () => {
  const c = (code: string): PrereqNode => ({ kind: "course", code });
  // OR[ STAT 220, coreqOf(STAT 230 or STAT 240) ] — the ACTSC 231 prereq branch.
  const branch: PrereqNode = {
    kind: "or",
    children: [
      c("stat220"),
      {
        kind: "coreqOf",
        child: { kind: "or", children: [c("stat230"), c("stat240")] },
      },
    ],
  };

  it("is satisfied when the prereq alternative (STAT 220) is completed", () => {
    expect(
      evaluate(branch, { completed: new Set(["stat220"]) }).satisfied,
    ).toBe(true);
  });

  it("is satisfied when the coreq is completed in a prior term", () => {
    const r = evaluate(branch, { completed: new Set(["stat230"]) });
    expect(r.satisfied).toBe(true);
    expect(r.uncertain).toBe(false);
  });

  it("is satisfied when the coreq is co-scheduled (concurrent) this term", () => {
    const r = evaluate(branch, {
      completed: new Set(),
      concurrent: new Set(["stat240"]),
    });
    expect(r.satisfied).toBe(true);
    expect(r.uncertain).toBe(false);
  });

  it("is a definite miss in planner context when neither route is taken", () => {
    const r = evaluate(branch, {
      completed: new Set(),
      concurrent: new Set(["other101"]),
    });
    expect(r.satisfied).toBe(false);
    // Both the prereq alternative and the coreq options are surfaced.
    expect(r.missingCourses).toEqual(
      expect.arrayContaining(["stat220", "stat230", "stat240"]),
    );
  });

  it("stays uncertain (never a false miss) with no concurrent context", () => {
    // Picker / course page: term placement unknown, so a not-yet-completed
    // coreq biases the OR to satisfiable+uncertain rather than failing STAT 220.
    const r = evaluate(branch, { completed: new Set() });
    expect(r.satisfied).toBe(true);
    expect(r.uncertain).toBe(true);
    expect(r.missingCourses).toEqual([]);
  });
});
