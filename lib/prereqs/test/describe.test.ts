import { describe, expect, it } from "vitest";
import { describeMissingPrereqs, describePrereqs } from "../describe";
import type { PrereqNode } from "../parse";
import { parsePrereqs } from "../parse";

const has = (...codes: string[]) => new Set(codes);

function missing(
  prereqs: string,
  completed: ReadonlySet<string>,
  level?: string,
): string | null {
  return describeMissingPrereqs(parsePrereqs(prereqs), completed, { level });
}

describe("describeMissingPrereqs", () => {
  it("returns null when there is no requirement", () => {
    expect(describeMissingPrereqs(null, has())).toBeNull();
  });

  it("returns null when the requirement is fully met", () => {
    expect(missing("CS136", has("cs136"))).toBeNull();
  });

  it("names a single missing course", () => {
    expect(missing("CS246", has())).toBe("CS 246");
  });

  it("keeps an unmet 'one of' group as a choice with every option", () => {
    expect(missing("One of CS116, CS136, CS138, CS146", has())).toBe(
      "one of CS 116, CS 136, CS 138, CS 146",
    );
  });

  it("drops a 'one of' group once any option is satisfied", () => {
    expect(
      missing("One of CS116, CS136, CS138, CS146", has("cs136")),
    ).toBeNull();
  });

  it("joins multiple unmet requirements with '; '", () => {
    expect(missing("One of CS116, CS136; MATH237 or MATH247", has())).toBe(
      "one of CS 116, CS 136; one of MATH 237, MATH 247",
    );
  });

  it("shows only the still-unmet clauses of a multi-part prereq (AMATH 242)", () => {
    // CS 136 satisfies clause 1; the rest are outstanding.
    const amath242 =
      "One of CS116, CS136, CS138, CS146; One of (CS114 with a minimum grade of 60%), CS115, CS135, CS145; MATH235 or MATH245; MATH237 or MATH247";
    expect(missing(amath242, has("cs136"))).toBe(
      "one of CS 114, CS 115, CS 135, CS 145; one of MATH 235, MATH 245; one of MATH 237, MATH 247",
    );
  });

  it("narrows to the final unmet group as earlier ones are met (the reported case)", () => {
    const amath242 =
      "One of CS116, CS136, CS138, CS146; One of (CS114 with a minimum grade of 60%), CS115, CS135, CS145; MATH235 or MATH245; MATH237 or MATH247";
    expect(missing(amath242, has("cs136", "cs135", "math235"))).toBe(
      "one of MATH 237, MATH 247",
    );
  });

  it("lists a course alternative alongside a known-failing level (OR)", () => {
    // At 2A the level branch fails definitely, so the OR is unmet and BOTH
    // open routes must show — not just the level gate.
    expect(missing("CS135 or level at least 3A", has(), "2A")).toBe(
      "one of CS 135, Level at least 3A",
    );
  });

  it("stays null for an OR with a level branch when the level is unknown", () => {
    // No level → the level branch is uncertain, biasing the OR to satisfiable,
    // so nothing is reported as a hard miss (unchanged behavior).
    expect(missing("CS135 or level at least 3A", has())).toBeNull();
  });

  it("returns null once the whole multi-part prereq is met", () => {
    const amath242 =
      "One of CS116, CS136, CS138, CS146; One of (CS114 with a minimum grade of 60%), CS115, CS135, CS145; MATH235 or MATH245; MATH237 or MATH247";
    expect(
      missing(amath242, has("cs136", "cs135", "math245", "math247")),
    ).toBeNull();
  });
});

describe("describeMissingPrereqs — countOf", () => {
  const countOf = (n: number, ...codes: string[]) => ({
    kind: "countOf" as const,
    n,
    children: codes.map((code) => ({ kind: "course" as const, code })),
  });

  it("lists 'N of <options>' for an unmet countOf", () => {
    expect(
      describeMissingPrereqs(countOf(2, "cs136", "cs138", "cs146"), has()),
    ).toBe("2 of CS 136, CS 138, CS 146");
  });

  it("returns null once n options are met", () => {
    expect(
      describeMissingPrereqs(
        countOf(2, "cs136", "cs138", "cs146"),
        has("cs136", "cs138"),
      ),
    ).toBeNull();
  });
});

describe("describePrereqs", () => {
  const course = (code: string): PrereqNode => ({ kind: "course", code });

  it("returns null for an absent tree", () => {
    expect(describePrereqs(null)).toBeNull();
    expect(describePrereqs(undefined)).toBeNull();
  });

  it("renders a lone course", () => {
    expect(describePrereqs(course("math137"))).toBe("MATH 137");
  });

  it("joins an or / and group without bracketing the top level", () => {
    expect(
      describePrereqs({
        kind: "or",
        children: [course("math137"), course("math147")],
      }),
    ).toBe("MATH 137 or MATH 147");
  });

  it("brackets a nested boolean group so precedence is unambiguous", () => {
    // ACTSC 231's prereqAst shape: (MATH137 or MATH147) and (STAT220 or coreq)
    // and Level 2A — the OR groups must be parenthesized inside the AND.
    const ast: PrereqNode = {
      kind: "and",
      children: [
        { kind: "or", children: [course("math137"), course("math147")] },
        {
          kind: "or",
          children: [
            course("stat220"),
            { kind: "raw", text: "Corequisite (see below)" },
          ],
        },
        { kind: "level", minLevel: "2A" },
      ],
    };
    expect(describePrereqs(ast)).toBe(
      "(MATH 137 or MATH 147) and (STAT 220 or Corequisite) and Level at least 2A",
    );
  });

  it("drops a Kuali '(see below)' cross-reference from raw text (ACTSC 231)", () => {
    // The coreq path is preserved as an option; only the dangling page pointer
    // — meaningless in our card layout — is stripped.
    const ast: PrereqNode = {
      kind: "or",
      children: [
        course("stat220"),
        { kind: "raw", text: "Corequisite (see below)" },
      ],
    };
    expect(describePrereqs(ast)).toBe("STAT 220 or Corequisite");
  });

  it("inlines a coreqOf branch as flat alternatives (ACTSC 231)", () => {
    // The corequisite path is shown inline (its concurrent-enrollment nuance is
    // evaluated, not displayed), and the same-kind inner OR is merged so the
    // whole branch reads as one flat choice rather than a nested group.
    const ast: PrereqNode = {
      kind: "or",
      children: [
        course("stat220"),
        {
          kind: "coreqOf",
          child: {
            kind: "or",
            children: [course("stat230"), course("stat240")],
          },
        },
      ],
    };
    expect(describePrereqs(ast)).toBe("STAT 220 or STAT 230 or STAT 240");
  });

  it("renders countOf and a program clause", () => {
    expect(
      describePrereqs({
        kind: "countOf",
        n: 2,
        children: [course("cs136"), course("cs138"), course("cs146")],
      }),
    ).toBe("2 of CS 136, CS 138, CS 146");
    expect(
      describePrereqs({
        kind: "program",
        clause: "Not open to Computer Science",
      }),
    ).toBe("Not open to Computer Science");
  });
});
