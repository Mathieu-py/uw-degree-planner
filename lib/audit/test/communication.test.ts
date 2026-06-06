import { describe, expect, it } from "vitest";
import { deriveCommunicationRequirement } from "@/lib/audit/communication";
import type { Program } from "@/lib/programs";

function flexible(extra: Record<string, unknown>): Program {
  return {
    kind: "flexible",
    name: "T",
    asOf: "2026",
    rules: { kind: "all", children: [] },
    ...extra,
  } as unknown as Program;
}

describe("deriveCommunicationRequirement", () => {
  it("returns null when the program states no communication requirement", () => {
    expect(deriveCommunicationRequirement(flexible({}), [])).toBeNull();
  });

  it("derives a pick-one requirement when the option isn't in the rules", () => {
    const program = flexible({
      degreeRequirements: {
        name: "Arts",
        communication: { options: ["arts160", "arts160e"] },
      },
    });
    const c = deriveCommunicationRequirement(program, []);
    expect(c).not.toBeNull();
    expect(c?.need).toBe(1);
    expect(c?.alreadyInTree).toBe(false);
    expect(c?.placed).toBe(0);
  });

  it("counts a placed option toward the requirement", () => {
    const program = flexible({
      degreeRequirements: {
        name: "Arts",
        communication: { options: ["arts160", "arts160e"] },
      },
    });
    const c = deriveCommunicationRequirement(program, ["arts160e"]);
    expect(c?.placed).toBe(1);
    expect(c?.satisfiers).toEqual(["arts160e"]);
  });

  it("flags alreadyInTree when an option is a named course in the rules", () => {
    const program = flexible({
      rules: { kind: "all", children: [{ kind: "courses", courses: ["commst193"] }] },
      degreeRequirements: {
        name: "Science",
        communication: { options: ["commst193", "engl193"] },
      },
    });
    expect(deriveCommunicationRequirement(program, [])?.alreadyInTree).toBe(true);
  });

  it("checks engineering term courses too", () => {
    const term = { kind: "all", children: [{ kind: "courses", courses: ["commst223"] }] };
    const program = {
      kind: "engineering",
      name: "Eng",
      asOf: "2026",
      terms: {
        "1A": term,
        "1B": term,
        "2A": term,
        "2B": term,
        "3A": term,
        "3B": term,
        "4A": term,
        "4B": term,
      },
      degreeRequirements: {
        name: "Eng",
        communication: { options: ["commst223"] },
      },
    } as unknown as Program;
    expect(deriveCommunicationRequirement(program, [])?.alreadyInTree).toBe(true);
  });
});
