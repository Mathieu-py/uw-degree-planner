import { describe, expect, it } from "vitest";
import type { ProgramIdentity } from "@/lib/programs";
import { parsePrereqs } from "../parse";
import { evaluate } from "../satisfied";

function user(completed: string[], level?: string) {
  return { completed: new Set(completed), level };
}

const SYDE: ProgramIdentity = {
  programId: "systems-design-engineering",
  names: ["systems design engineering", "syde"],
  faculty: "engineering",
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
    const result = evaluate(node, { completed: new Set(), program: SYDE });
    expect(result.satisfied).toBe(false);
    expect(result.uncertain).toBe(false);
    expect(result.missingCourses).toEqual([]);
    expect(result.rawRequirements).toEqual(["Anthropology students only"]);
  });

  it("program restriction passes for an allowed faculty", () => {
    const node = parsePrereqs("Open only to students in Engineering");
    const result = evaluate(node, { completed: new Set(), program: SYDE });
    expect(result.satisfied).toBe(true);
    expect(result.uncertain).toBe(false);
  });

  it("suppressProgramBlock demotes a wrong-program block to an uncertain check", () => {
    const node = parsePrereqs("Anthropology students only");
    // Without suppression: a hard fail.
    const hard = evaluate(node, { completed: new Set(), program: SYDE });
    expect(hard.satisfied).toBe(false);
    expect(hard.blockedByProgram).toBe(true);
    // With suppression (course is program-referenced): satisfied + uncertain,
    // and no longer attributed to a program block.
    const soft = evaluate(node, {
      completed: new Set(),
      program: SYDE,
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
      program: SYDE,
    });
    expect(result.satisfied).toBe(false);
  });

  it("flags blockedByProgram only for a confirmed program restriction", () => {
    const blocked = evaluate(parsePrereqs("Anthropology students only"), {
      completed: new Set(),
      program: SYDE,
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
