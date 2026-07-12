import { describe, expect, it } from "vitest";
import { PROGRAMS, type Program } from "@/lib/programs";
import { enumerateVariantGroups } from "../variantGroups";

describe("enumerateVariantGroups", () => {
  it("surfaces a flexible program's course-variant picks, term-agnostic", () => {
    const groups = enumerateVariantGroups(
      PROGRAMS["h-computer-science-bcs"],
      "h-computer-science-bcs",
    );
    expect(groups.length).toBeGreaterThanOrEqual(14);
    expect(groups.every((g) => g.termLabel === null)).toBe(true);

    // The intro-CS "Complete 1 of" variant.
    const intro = groups.find(
      (g) => g.options.join(",") === "cs115,cs135,cs145",
    );
    expect(intro).toBeDefined();
    expect(intro?.selectMin).toBe(1);
    expect(intro?.selectMax).toBe(1);

    // A genuine choose-N pool is surfaced too (nothing hidden).
    expect(groups.some((g) => g.selectMin === 3)).toBe(true);
  });

  it("carries the rule's term label for engineering picks", () => {
    const groups = enumerateVariantGroups(
      PROGRAMS["computer-engineering"],
      "computer-engineering",
    );
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.every((g) => g.termLabel !== null)).toBe(true);

    const comm = groups.find(
      (g) => g.options.includes("commst192") && g.options.includes("engl192"),
    );
    expect(comm?.termLabel).toBe("1A");

    const multi = groups.find((g) => g.termLabel === "3B" && g.selectMin === 2);
    expect(multi?.selectMax).toBe(2);
  });

  it("excludes functionally-mandatory picks but keeps real choices", () => {
    const program: Program = {
      kind: "flexible",
      name: "Synthetic",
      asOf: "2026",
      rules: {
        kind: "all",
        children: [
          // pick(1,1) over a single option = mandatory → not a choice.
          {
            kind: "pick",
            selectMin: 1,
            selectMax: 1,
            children: [{ kind: "courses", courses: ["mand101"] }],
          },
          // A real either/or.
          {
            kind: "pick",
            selectMin: 1,
            selectMax: 1,
            children: [{ kind: "courses", courses: ["opta", "optb"] }],
          },
          { kind: "courses", courses: ["req101"] },
        ],
      },
    };
    const groups = enumerateVariantGroups(program, "synthetic");
    expect(groups).toHaveLength(1);
    expect(groups[0].options).toEqual(["opta", "optb"]);
    expect(groups[0].termLabel).toBeNull();
  });

  it("stamps program-scoped keys so a double degree's groups never collide", () => {
    // `key` is seeded by programId precisely so two concatenated programs (a
    // double degree) can't clash — assert the union carries no key collision.
    const cs = enumerateVariantGroups(
      PROGRAMS["h-computer-science-bcs"],
      "h-computer-science-bcs",
    );
    const ce = enumerateVariantGroups(
      PROGRAMS["computer-engineering"],
      "computer-engineering",
    );
    const keys = new Set([...cs, ...ce].map((g) => g.key));
    expect(keys.size).toBe(cs.length + ce.length);
    expect(cs.every((g) => g.programId === "h-computer-science-bcs")).toBe(
      true,
    );
    expect(ce.every((g) => g.programId === "computer-engineering")).toBe(true);
  });
});
