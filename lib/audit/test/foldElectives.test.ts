import { describe, expect, it } from "vitest";
import type {
  ElectiveCategory,
  Program,
  RuleNode,
  Specialization,
} from "@/lib/programs";
import { classifyElective } from "../electives";
import { foldFiniteElectivesIntoRules } from "../foldElectives";

/** Narrow a folded program to its flexible `all` root for assertions. */
function rulesAll(program: Program): Extract<RuleNode, { kind: "all" }> {
  if (program.kind === "engineering")
    throw new Error("expected a flexible program");
  const root = program.rules;
  if (root.kind !== "all")
    throw new Error(`expected all root, got ${root.kind}`);
  return root;
}

function asAll(node: RuleNode | undefined): Extract<RuleNode, { kind: "all" }> {
  if (node?.kind !== "all") throw new Error(`expected all, got ${node?.kind}`);
  return node;
}

const APPROVED: ElectiveCategory = {
  description: "Approved Courses List",
  requiredCount: 2,
  approvedCourses: ["chem101", "chem102", "chem103"],
};

function flex(electives: ElectiveCategory[], rules?: RuleNode): Program {
  return {
    kind: "flexible",
    name: "Toy",
    asOf: "2026",
    rules: rules ?? {
      kind: "all",
      children: [{ kind: "courses", courses: ["cs115"] }],
    },
    electives,
  };
}

describe("foldFiniteElectivesIntoRules", () => {
  it("folds a finite list into a named all>pick>courses group, matching classifyElective", () => {
    const out = foldFiniteElectivesIntoRules(flex([APPROVED]));
    expect(out.electives).toEqual([]); // finite entry removed
    const children = rulesAll(out).children;
    expect(children.length).toBe(2); // original leaf + folded group

    const section = classifyElective(APPROVED);
    expect(section.kind).toBe("finite");
    if (section.kind !== "finite") return;
    expect(children[1]).toEqual({
      kind: "all",
      description: section.title,
      children: [
        {
          kind: "pick",
          selectMin: section.need,
          selectMax: section.need,
          children: [{ kind: "courses", courses: section.options }],
        },
      ],
    });
  });

  it("keeps non-finite electives (subject pools) in the Electives tab", () => {
    const pool: ElectiveCategory = {
      description: "6.0 units of ANTH courses",
      unitRequirement: 6.0,
    };
    const out = foldFiniteElectivesIntoRules(flex([APPROVED, pool]));
    expect(out.electives).toEqual([pool]); // finite folded out, pool stays
    expect(rulesAll(out).children.length).toBe(2);
  });

  it("leaves an '…Electives…'-titled finite list in the Electives tab", () => {
    const program = flex([
      {
        description: "Technical Electives List",
        requiredCount: 3,
        approvedCourses: ["syde522", "syde543", "syde548"],
      },
    ]);
    // Nothing folds → same object back; the list stays an elective.
    expect(foldFiniteElectivesIntoRules(program)).toBe(program);
  });

  it("disambiguates duplicate titles with a trailing index", () => {
    const out = foldFiniteElectivesIntoRules(
      flex([
        {
          description: "Approved Courses List",
          requiredCount: 1,
          approvedCourses: ["a100", "b100"],
        },
        {
          description: "Approved Courses List",
          requiredCount: 1,
          approvedCourses: ["c100", "d100"],
        },
      ]),
    );
    const descs = rulesAll(out)
      .children.slice(1)
      .map((c) => (c.kind === "all" ? c.description : undefined));
    expect(descs).toEqual([
      "Approved Courses List",
      "Approved Courses List (2)",
    ]);
  });

  it("wraps a non-'all' root when folding", () => {
    const out = foldFiniteElectivesIntoRules(
      flex([APPROVED], { kind: "courses", courses: ["cs115"] }),
    );
    const children = rulesAll(out).children;
    expect(children[0]).toEqual({ kind: "courses", courses: ["cs115"] });
    expect(children[1].kind === "all" && children[1].description).toBe(
      "Approved Courses List",
    );
  });

  it("returns engineering programs unchanged (no rule tree to fold into)", () => {
    const eng = {
      kind: "engineering",
      name: "Eng",
      asOf: "2026",
      terms: {},
      electives: [APPROVED],
    } as unknown as Program;
    expect(foldFiniteElectivesIntoRules(eng)).toBe(eng);
  });

  it("returns unchanged when there are no finite lists", () => {
    const program = flex([]);
    expect(foldFiniteElectivesIntoRules(program)).toBe(program);
  });

  // ---- Specialization-level folding ----
  function spec(
    electives: ElectiveCategory[],
    rules?: RuleNode,
  ): Specialization {
    return {
      slug: "s1",
      name: "Spec",
      kualiId: "k1",
      ...(rules ? { rules } : {}),
      electives,
    };
  }
  function withSpec(s: Specialization, top: ElectiveCategory[] = []): Program {
    return { ...flex(top), specializations: [s] };
  }

  it("folds a spec's finite list into its existing spec.rules", () => {
    const out = foldFiniteElectivesIntoRules(
      withSpec(
        spec([APPROVED], {
          kind: "all",
          children: [{ kind: "courses", courses: ["pacs331"] }],
        }),
      ),
    );
    const outSpec = out.specializations?.[0];
    expect(outSpec?.electives).toEqual([]);
    const children = asAll(outSpec?.rules).children;
    expect(children.length).toBe(2); // existing leaf + folded group
    expect(children[1].kind === "all" && children[1].description).toBe(
      "Approved Courses List",
    );
  });

  it("creates spec.rules when the spec has none", () => {
    const out = foldFiniteElectivesIntoRules(withSpec(spec([APPROVED])));
    const children = asAll(out.specializations?.[0]?.rules).children;
    expect(children.length).toBe(1);
    expect(children[0].kind === "all" && children[0].description).toBe(
      "Approved Courses List",
    );
  });

  it("leaves a spec's non-finite electives in place", () => {
    const program = withSpec(
      spec([
        { description: "6.0 units of ANTH courses", unitRequirement: 6.0 },
      ]),
    );
    expect(foldFiniteElectivesIntoRules(program)).toBe(program);
  });

  it("folds a spec's finite list even for an engineering program (top level stays)", () => {
    const eng = {
      kind: "engineering",
      name: "Eng",
      asOf: "2026",
      terms: {},
      electives: [APPROVED],
      specializations: [
        spec([APPROVED], {
          kind: "all",
          children: [{ kind: "courses", courses: ["a100"] }],
        }),
      ],
    } as unknown as Program;
    const out = foldFiniteElectivesIntoRules(eng);
    expect(out.electives).toEqual([APPROVED]); // engineering top level not folded
    expect(out.specializations?.[0]?.electives).toEqual([]); // spec folded
    expect(asAll(out.specializations?.[0]?.rules).children.length).toBe(2);
  });
});
