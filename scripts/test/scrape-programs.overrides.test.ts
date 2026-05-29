import { describe, expect, it } from "vitest";
import type { RuleNode } from "../../lib/programs";
import { applyRuleOverrides } from "../scrape-programs.overrides";

/** Collect every course code referenced anywhere in a rule tree. */
function collectCourses(node: RuleNode): string[] {
  switch (node.kind) {
    case "courses":
    case "excluded":
      return node.courses;
    case "all":
    case "pick":
      return node.children.flatMap(collectCourses);
    default:
      return [];
  }
}

/** Find the nearest "pick" group that directly offers the comms courses. */
function findCommsPick(node: RuleNode): RuleNode | undefined {
  if (node.kind === "pick" || node.kind === "all") {
    for (const child of node.children) {
      if (
        child.kind === "courses" &&
        child.courses.includes("commst193") &&
        child.courses.includes("engl193")
      ) {
        return node;
      }
      const found = findCommsPick(child);
      if (found) return found;
    }
  }
  return undefined;
}

describe("applyRuleOverrides", () => {
  it("injects the missing comms requirement for hydrogeology", () => {
    const rules: RuleNode = {
      kind: "all",
      children: [
        {
          kind: "all",
          children: [{ kind: "courses", courses: ["earth121", "math127"] }],
        },
      ],
    };

    const patched = applyRuleOverrides("earth-sciences-hydrogeology", rules);
    const codes = collectCourses(patched);

    expect(codes).toContain("commst193");
    expect(codes).toContain("engl193");
    // The original required courses survive untouched.
    expect(codes).toContain("earth121");
    expect(codes).toContain("math127");
  });

  it("models the comms requirement as 'pick exactly 1 of two'", () => {
    const rules: RuleNode = {
      kind: "all",
      children: [{ kind: "all", children: [] }],
    };

    const pick = findCommsPick(
      applyRuleOverrides("earth-sciences-hydrogeology", rules),
    );

    expect(pick?.kind).toBe("pick");
    if (pick?.kind === "pick") {
      expect(pick.selectMin).toBe(1);
      expect(pick.selectMax).toBe(1);
    }
  });

  it("appends into the inner 'all' group, not a new wrapping layer", () => {
    const rules: RuleNode = {
      kind: "all",
      children: [
        {
          kind: "all",
          children: [{ kind: "courses", courses: ["earth121"] }],
        },
      ],
    };

    const patched = applyRuleOverrides("earth-sciences-hydrogeology", rules);

    expect(patched.kind).toBe("all");
    if (patched.kind === "all") {
      expect(patched.children).toHaveLength(1);
      const inner = patched.children[0];
      expect(inner.kind).toBe("all");
      if (inner.kind === "all") expect(inner.children).toHaveLength(2);
    }
  });

  it("returns rules unchanged for programs without an override", () => {
    const rules: RuleNode = {
      kind: "all",
      children: [{ kind: "courses", courses: ["cs135"] }],
    };

    expect(applyRuleOverrides("h-computer-science-bcs", rules)).toBe(rules);
  });

  it("wraps a non-'all' root so the override is still required", () => {
    const rules: RuleNode = { kind: "courses", courses: ["earth121"] };

    const patched = applyRuleOverrides("earth-sciences-hydrogeology", rules);
    const codes = collectCourses(patched);

    expect(patched.kind).toBe("all");
    expect(codes).toContain("earth121");
    expect(codes).toContain("commst193");
    expect(codes).toContain("engl193");
  });
});
