import { describe, expect, it } from "vitest";
import { parsePrereqs } from "../parse";
import { evaluate } from "../satisfied";

function user(completed: string[], level?: string) {
  return { completed: new Set(completed), level };
}

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
    const result = evaluate(parsePrereqs("MATH116 and CO250"), user(["math116"]));
    expect(result.satisfied).toBe(false);
    expect(result.missingCourses).toEqual(["co250"]);
  });

  it("treats raw program text as uncertain", () => {
    const result = evaluate(
      parsePrereqs("MATH116; Honours Mathematics students only"),
      user(["math116"]),
    );
    expect(result.uncertain).toBe(true);
    expect(result.rawRequirements).toContain("Honours Mathematics students only");
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
});
