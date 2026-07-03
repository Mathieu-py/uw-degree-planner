import { describe, expect, it } from "vitest";
import { compileAudit } from "@/lib/audit/compile";
import type { LocalPlan } from "@/lib/plan/types";
import type { Program } from "@/lib/programs";
import { deriveMacros } from "../deriveMacros";
import type { Section } from "../types";

/** Flatten every macro's rendered Section rows. */
function sectionsOf(
  macros: ReturnType<typeof deriveMacros>["macros"],
): Section[] {
  return macros.flatMap((m) =>
    m.blocks.flatMap((b) =>
      b.content.kind === "sections" ? b.content.sections : [],
    ),
  );
}

function makePlan(codes: string[]): LocalPlan {
  return {
    schemaVersion: 3,
    programIds: ["test"],
    specializationIds: {},
    stream: "regular",
    startTermId: 1239,
    slots: [
      {
        id: "s1",
        termId: 1239,
        position: "1A",
        isCoop: false,
        courses: codes.map((c) => ({ code: c })),
      },
    ],
    updatedAt: "2026-05-23T12:00:00.000Z",
  };
}

/** Compile a plan, then derive the panel's macro sections (0.5 unit/course). */
function macrosOf(program: Program, codes: string[]) {
  const audit = compileAudit(program, makePlan(codes), null, new Set());
  return deriveMacros(audit, program, 0, [], [], () => 0.5, new Set());
}

const PROGRAM: Program = {
  kind: "flexible",
  name: "Toy",
  asOf: "2026",
  rules: {
    kind: "all",
    children: [
      { kind: "courses", courses: ["cs115", "math115"] },
      { kind: "courses", courses: ["cs136"] },
    ],
  },
  unitPlan: { totalUnits: 1.5 },
};

describe("deriveMacros", () => {
  it("builds a Degree requirements macro from the rule tree", () => {
    const { macros } = macrosOf(PROGRAM, []);
    const degree = macros.find((m) => m.key === "degree");
    expect(degree).toBeDefined();
    expect(degree?.label).toBe("Degree requirements");
    expect(degree?.defaultOpen).toBe(true);
    expect(degree?.blocks.length).toBeGreaterThan(0);
  });

  it("counts placed courses toward the degree macro's header chip", () => {
    const empty = macrosOf(PROGRAM, []).macros.find((m) => m.key === "degree");
    const partial = macrosOf(PROGRAM, ["cs115", "math115"]).macros.find(
      (m) => m.key === "degree",
    );
    expect(empty?.count).toEqual({ satisfied: 0, needed: 3 });
    expect(partial?.count).toEqual({ satisfied: 2, needed: 3 });
  });

  it("uses headline elective credit for the finite chip, not an independent count (#8)", () => {
    const program: Program = {
      ...PROGRAM,
      electives: [
        {
          description: "Technical Electives",
          requiredCount: 1,
          approvedCourses: ["te1", "te2"],
        },
      ],
    };
    const audit = compileAudit(
      program,
      makePlan(["te1", "te2"]),
      null,
      new Set(),
    );
    const finiteOf = (m: ReturnType<typeof deriveMacros>["macros"]) =>
      sectionsOf(m).find((s) => s.kind === "electiveFinite");

    // Both te1 and te2 are placed. The independent count is 2 (over-counts an
    // option a named requirement may have claimed); the headline credited only 1.
    const withCredit = deriveMacros(
      audit,
      program,
      0,
      [],
      [],
      () => 0.5,
      new Set(),
      undefined,
      [1], // electiveCredit index-aligned to deriveElectiveSections
    ).macros;
    const s = finiteOf(withCredit);
    expect(s && s.kind === "electiveFinite" ? s.placed : null).toBe(1);

    // Without a credit array (read-only view), it falls back to the raw count.
    const noCredit = deriveMacros(
      audit,
      program,
      0,
      [],
      [],
      () => 0.5,
      new Set(),
    ).macros;
    const s2 = finiteOf(noCredit);
    expect(s2 && s2.kind === "electiveFinite" ? s2.placed : null).toBe(2);
  });

  it("does NOT surface unverified requirements in a macro", () => {
    // Unverified rules are now rendered near the headline as acknowledgeable
    // rows (buildProgramAudit → UnverifiedRequirements), not buried in a macro.
    const program: Program = {
      ...PROGRAM,
      unverifiedRequirements: ["Complete a co-op work term."],
    };
    const { macros } = macrosOf(program, []);
    const sections = sectionsOf(macros);
    expect(
      sections.some(
        (s) =>
          ("caption" in s && s.caption === "Complete a co-op work term.") ||
          (s.kind === "infoGroup" &&
            s.items.includes("Complete a co-op work term.")),
      ),
    ).toBe(false);
  });

  it("folds same-titled informational notes into one collapsible infoGroup", () => {
    const program: Program = {
      ...PROGRAM,
      informational: [
        { label: "Additional constraint", text: "Note A." },
        { label: "Additional constraint", text: "Note B." },
        { label: "Additional constraint", text: "Note C." },
        { label: "Minimum average", text: "60% overall." },
      ],
    };
    const groups = sectionsOf(macrosOf(program, []).macros).filter(
      (s): s is Extract<Section, { kind: "infoGroup" }> =>
        s.kind === "infoGroup",
    );
    // One group per distinct title, in first-seen order; the repeated title
    // carries all three notes instead of three separate rows.
    expect(groups.map((g) => g.title)).toEqual([
      "Additional constraint",
      "Minimum average",
    ]);
    expect(groups[0].items).toEqual(["Note A.", "Note B.", "Note C."]);
    expect(groups[1].items).toEqual(["60% overall."]);
  });

  it("dedupes identical notes folded under one title (no duplicate rows/keys)", () => {
    // Two notes with the same title AND text (e.g. both defaulting to the same
    // advisory) must collapse to a single item — else SectionRow renders (and
    // keys) it twice. Regression for #117 review.
    const program: Program = {
      ...PROGRAM,
      informational: [
        { label: "Additional constraint", text: "Verify with your advisor." },
        { label: "Additional constraint", text: "Verify with your advisor." },
        { label: "Additional constraint", text: "A distinct note." },
      ],
    };
    const groups = sectionsOf(macrosOf(program, []).macros).filter(
      (s): s is Extract<Section, { kind: "infoGroup" }> =>
        s.kind === "infoGroup",
    );
    expect(groups[0].items).toEqual([
      "Verify with your advisor.",
      "A distinct note.",
    ]);
  });
});
