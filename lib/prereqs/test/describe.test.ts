import { describe, expect, it } from "vitest";
import { describeMissingPrereqs } from "../describe";
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
