import { describe, expect, it } from "vitest";
import { compileAudit } from "@/lib/audit/compile";
import type { LocalPlan } from "@/lib/plan/types";
import type { Program } from "@/lib/programs";
import { deriveMacros } from "../deriveMacros";

function makePlan(codes: string[]): LocalPlan {
  return {
    schemaVersion: 1,
    programId: "test",
    specializationId: null,
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

  it("reports no unverified requirements for a fully-structured program", () => {
    expect(macrosOf(PROGRAM, []).unverifiedCount).toBe(0);
  });

  it("surfaces unverified requirements in the Co-op & other macro", () => {
    const program: Program = {
      ...PROGRAM,
      unverifiedRequirements: ["Complete a co-op work term."],
    };
    const { macros, unverifiedCount } = macrosOf(program, []);
    expect(unverifiedCount).toBe(1);
    const other = macros.find((m) => m.key === "other");
    expect(other?.blocks[0].content).toMatchObject({ kind: "sections" });
    const sections =
      other?.blocks[0].content.kind === "sections"
        ? other.blocks[0].content.sections
        : [];
    expect(sections.some((s) => s.kind === "info")).toBe(true);
  });
});
