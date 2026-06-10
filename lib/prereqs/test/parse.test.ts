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

  it("captures a program restriction as a program node", () => {
    expect(parsePrereqs("Honours Mathematics students only")).toEqual({
      kind: "program",
      clause: "Honours Mathematics students only",
    });
  });

  it("keeps a course prereq and trailing program restriction separate", () => {
    const node = parsePrereqs(
      "CS234 or CS240; Honours Mathematics or Software Engineering students only",
    );
    expect(node?.kind).toBe("and");
    if (node?.kind === "and") {
      expect(courses(node).sort()).toEqual(["cs234", "cs240"]);
      expect(node.children).toContainEqual({
        kind: "program",
        clause: "Honours Mathematics or Software Engineering students only",
      });
    }
  });

  it("captures a level requirement before a program restriction", () => {
    const node = parsePrereqs(
      "Level at least 4A Mathematics or Science students only",
    );
    expect(node?.kind).toBe("and");
    if (node?.kind === "and") {
      expect(node.children).toContainEqual({ kind: "level", minLevel: "4A" });
      expect(node.children).toContainEqual({
        kind: "program",
        clause: "Mathematics or Science students only",
      });
    }
  });

  it("captures an 'Open only to students in …' restriction", () => {
    expect(parsePrereqs("Open only to students in Engineering")).toEqual({
      kind: "program",
      clause: "Open only to students in Engineering",
    });
  });

  it("captures a bare 'level + program' restriction with no 'students' word", () => {
    // e.g. CIVE125's "1A Civil Engineering" — a cohort lock written without
    // the word "students". Must become a program node, not raw → "check".
    expect(parsePrereqs("1A Civil Engineering")).toEqual({
      kind: "program",
      clause: "1A Civil Engineering",
    });
  });

  it("captures a bare '… students' restriction (no 'only') after a course", () => {
    // The dominant AFM phrasing: "<course>; <programs> students" with no "only".
    const node = parsePrereqs(
      "AFM101; Accounting and Financial Management, Computing and Financial Management students",
    );
    expect(node?.kind).toBe("and");
    if (node?.kind === "and") {
      expect(node.children).toContainEqual({ kind: "course", code: "afm101" });
      expect(node.children).toContainEqual({
        kind: "program",
        clause:
          "Accounting and Financial Management, Computing and Financial Management students",
      });
    }
  });

  it("keeps an 'or' before a program restriction as an OR, not an AND", () => {
    // The leading "or" is the connective joining the alternatives, not part of
    // the clause — so this is an OR(course, program), not AND.
    const node = parsePrereqs("CS241 or Honours Mathematics students only");
    expect(node?.kind).toBe("or");
    if (node?.kind === "or") {
      expect(node.children).toContainEqual({ kind: "course", code: "cs241" });
      expect(node.children).toContainEqual({
        kind: "program",
        clause: "Honours Mathematics students only",
      });
    }
  });

  it("flattens nested AND/OR", () => {
    const node = parsePrereqs("MATH116 or MATH117 or MATH118");
    expect(node?.kind).toBe("or");
    if (node?.kind === "or") expect(node.children).toHaveLength(3);
  });
});
