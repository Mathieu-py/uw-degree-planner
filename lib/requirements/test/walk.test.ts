import { describe, expect, it } from "vitest";
import type { RuleNode } from "../types";
import { flatCoursePickOptions } from "../walk";

function pick(children: RuleNode[]): Extract<RuleNode, { kind: "pick" }> {
  return { kind: "pick", selectMin: 1, selectMax: 1, children };
}

function courses(...codes: string[]): RuleNode {
  return { kind: "courses", courses: codes };
}

describe("flatCoursePickOptions", () => {
  it("unions all-courses children, deduped in first-occurrence order", () => {
    const opts = flatCoursePickOptions(
      pick([courses("cs115", "cs135"), courses("cs135", "cs145")]),
    );
    expect(opts).toEqual(["cs115", "cs135", "cs145"]);
  });

  it("returns null for a compound pick (any non-courses child)", () => {
    const compound = pick([
      courses("cs115"),
      { kind: "all", children: [courses("cs135"), courses("cs136")] },
    ]);
    expect(flatCoursePickOptions(compound)).toBeNull();
  });

  it("returns null for a childless pick", () => {
    expect(flatCoursePickOptions(pick([]))).toBeNull();
  });
});
