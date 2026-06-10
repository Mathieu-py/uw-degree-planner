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

  describe("trailing grade prose does not truncate the expression", () => {
    it("keeps a 'one of' list whole when its first item carries a parenthesized grade qualifier", () => {
      // Regression: AMATH 242. The prose "with a minimum grade of 60%" inside
      // the parens used to strand the ")", collapsing "one of four" into just
      // CS114 and dropping every later clause (CS115/135/145 and both MATH
      // groups). All options must survive.
      const node = parsePrereqs(
        "One of CS116, CS136, CS138, CS146; One of (CS114 with a minimum grade of 60%), CS115, CS135, CS145; MATH235 or MATH245; MATH237 or MATH247",
      );
      expect(courses(node).sort()).toEqual([
        "cs114",
        "cs115",
        "cs116",
        "cs135",
        "cs136",
        "cs138",
        "cs145",
        "cs146",
        "math235",
        "math237",
        "math245",
        "math247",
      ]);
    });

    it("drops a non-parenthesized grade qualifier and keeps the following clause", () => {
      // ACTSC232: "One of STAT230, STAT240; ACTSC231 with a minimum grade of 60%."
      const node = parsePrereqs(
        "One of STAT230, STAT240; ACTSC231 with a minimum grade of 60%.",
      );
      expect(courses(node).sort()).toEqual(["actsc231", "stat230", "stat240"]);
    });

    it("keeps an 'or' alternative that follows a grade qualifier inside parens", () => {
      // MATH249: "(MATH135 with minimum grade of 80% or MATH145) and (MATH136 or MATH146); …"
      const node = parsePrereqs(
        "(MATH135 with minimum grade of 80% or MATH145) and (MATH136 or MATH146)",
      );
      expect(courses(node).sort()).toEqual([
        "math135",
        "math136",
        "math145",
        "math146",
      ]);
    });

    it("keeps a trailing program restriction after a parenthesized grade clause", () => {
      // STAT230-shaped: grade prose inside parens, then a trailing restriction.
      const node = parsePrereqs(
        "(MATH128 with a minimum grade of 60%) or (one of MATH118, MATH119, MATH138, MATH148); Honours Math students only",
      );
      expect(node?.kind).toBe("and");
      expect(courses(node).sort()).toEqual([
        "math118",
        "math119",
        "math128",
        "math138",
        "math148",
      ]);
      if (node?.kind === "and") {
        expect(node.children).toContainEqual({
          kind: "program",
          clause: "Honours Math students only",
        });
      }
    });

    it("still surfaces pure-prose prereqs as a raw node", () => {
      // A RAW that is a whole primary (not trailing a structured requirement)
      // must remain a raw node so the UI shows "check", not silently pass.
      expect(parsePrereqs("Permission of the instructor")).toEqual({
        kind: "raw",
        text: "Permission of the instructor",
      });
    });
  });
});
