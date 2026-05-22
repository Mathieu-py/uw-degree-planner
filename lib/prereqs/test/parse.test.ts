import { describe, expect, it } from "vitest";
import { type PrereqNode, parsePrereqs } from "../parse";

function courses(node: PrereqNode | null): string[] {
  if (!node) return [];
  if (node.kind === "course") return [node.code];
  if (node.kind === "and" || node.kind === "or") {
    return node.children.flatMap(courses);
  }
  return [];
}

describe("parsePrereqs", () => {
  it("returns null for empty input", () => {
    expect(parsePrereqs(null)).toBeNull();
    expect(parsePrereqs("")).toBeNull();
    expect(parsePrereqs("   ")).toBeNull();
  });

  it("parses a single course", () => {
    expect(parsePrereqs("MATH116")).toEqual({
      kind: "course",
      code: "math116",
    });
  });

  it("parses 'X or Y' as OR", () => {
    const node = parsePrereqs("MATH116 or MATH117");
    expect(node).toEqual({
      kind: "or",
      children: [
        { kind: "course", code: "math116" },
        { kind: "course", code: "math117" },
      ],
    });
  });

  it("parses 'X and Y' as AND", () => {
    const node = parsePrereqs("MATH116 and CO250");
    expect(node).toEqual({
      kind: "and",
      children: [
        { kind: "course", code: "math116" },
        { kind: "course", code: "co250" },
      ],
    });
  });

  it("parses '; ' as AND between clauses", () => {
    const node = parsePrereqs("MATH116 or MATH117; CO250");
    expect(node?.kind).toBe("and");
    expect(courses(node).sort()).toEqual(["co250", "math116", "math117"]);
  });

  it("parses 'one of A, B, C' as OR", () => {
    const node = parsePrereqs("One of MATH118, MATH128, MATH138");
    expect(node).toEqual({
      kind: "or",
      children: [
        { kind: "course", code: "math118" },
        { kind: "course", code: "math128" },
        { kind: "course", code: "math138" },
      ],
    });
  });

  it("parses slash equivalents as OR", () => {
    const node = parsePrereqs("AFM382/AFM481");
    expect(node).toEqual({
      kind: "or",
      children: [
        { kind: "course", code: "afm382" },
        { kind: "course", code: "afm481" },
      ],
    });
  });

  it("respects parentheses for grouping", () => {
    const node = parsePrereqs("(MATH116 or MATH117) and CO250");
    expect(node?.kind).toBe("and");
    if (node?.kind === "and") {
      expect(node.children[0]).toEqual({
        kind: "or",
        children: [
          { kind: "course", code: "math116" },
          { kind: "course", code: "math117" },
        ],
      });
      expect(node.children[1]).toEqual({ kind: "course", code: "co250" });
    }
  });

  it("captures level requirements as level nodes", () => {
    const node = parsePrereqs("MATH116; Level at least 2A Civil Engineering.");
    expect(node?.kind).toBe("and");
    if (node?.kind === "and") {
      expect(node.children).toContainEqual({ kind: "level", minLevel: "2A" });
      expect(node.children).toContainEqual({ kind: "course", code: "math116" });
    }
  });

  it("captures program-only text as raw", () => {
    const node = parsePrereqs("Honours Mathematics students only");
    expect(node?.kind).toBe("raw");
  });

  it("flattens nested AND/OR", () => {
    const node = parsePrereqs("MATH116 or MATH117 or MATH118");
    expect(node?.kind).toBe("or");
    if (node?.kind === "or") expect(node.children).toHaveLength(3);
  });
});
