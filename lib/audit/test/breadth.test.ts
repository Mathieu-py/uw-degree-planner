import { describe, expect, it } from "vitest";
import type { Program, UnitConstraint } from "@/lib/programs";
import {
  deriveBreadthRequirements,
  nonBreadthConstraints,
  parseBreadthConstraint,
} from "../breadth";

const hum: UnitConstraint = {
  label: "Breadth — Humanities",
  sourceText: "Humanities — 1.0 unit: CLAS, ENGL, HIST, MEDVL, PHIL",
};
const fpca: UnitConstraint = {
  label: "Breadth — Fine, Performing, and Communication Arts",
  sourceText:
    "Fine, Performing, and Communication Arts — 0.5 unit: COMMST, DAC, FINE, MUSIC, THPERF, VCULT",
};
const social: UnitConstraint = {
  label: "Breadth — Social Sciences",
  sourceText: "Social Sciences — 2.0 units: ANTH, ECON, PSCI, PSYCH, SDS, SOC",
};
const levelOnly: UnitConstraint = {
  label: "Level minimum",
  sourceText: "Complete a minimum of 3.0 units at the 200-level or above",
};

/** Minimal Program carrying just the constraints the breadth logic reads. */
function prog(unit: UnitConstraint[], degree?: UnitConstraint[]): Program {
  return {
    unitPlan: { constraints: unit },
    ...(degree
      ? { degreeRequirements: { name: "x", constraints: degree } }
      : {}),
  } as unknown as Program;
}

describe("parseBreadthConstraint", () => {
  it("keeps a 1.0-unit breadth note in units (as the calendar states it)", () => {
    const p = parseBreadthConstraint(hum);
    expect(p).not.toBeNull();
    expect(p?.title).toBe("Humanities");
    expect(p?.needUnits).toBe(1.0);
    expect(p?.subjects).toEqual(["CLAS", "ENGL", "HIST", "MEDVL", "PHIL"]);
  });

  it("preserves the stated units (0.5 and 2.0)", () => {
    expect(parseBreadthConstraint(fpca)?.needUnits).toBe(0.5);
    expect(parseBreadthConstraint(social)?.needUnits).toBe(2.0);
  });

  it("keeps the full group name as the title", () => {
    expect(parseBreadthConstraint(fpca)?.title).toBe(
      "Fine, Performing, and Communication Arts",
    );
  });

  it("returns null for a level-only minimum (no subject list)", () => {
    expect(parseBreadthConstraint(levelOnly)).toBeNull();
  });
});

describe("deriveBreadthRequirements", () => {
  const half = () => 0.5;

  it("sums placed units whose subject is in the list", () => {
    const reqs = deriveBreadthRequirements(
      prog([hum, social]),
      ["phil100", "hist250", "econ101", "math135"], // last matches neither
      half,
    );
    const humReq = reqs.find((r) => r.title === "Humanities");
    expect(humReq?.placedUnits).toBe(1.0); // phil100 + hist250, 0.5 each
    expect([...(humReq?.satisfiers ?? [])].sort()).toEqual([
      "hist250",
      "phil100",
    ]);
    const socReq = reqs.find((r) => r.title === "Social Sciences");
    expect(socReq?.placedUnits).toBe(0.5); // econ101
    expect(socReq?.needUnits).toBe(2.0);
  });

  it("credits a 1.0-unit course as a full unit", () => {
    const reqs = deriveBreadthRequirements(prog([hum]), ["clas201"], (code) =>
      code === "clas201" ? 1.0 : 0.5,
    );
    expect(reqs[0].placedUnits).toBe(1.0); // satisfies the 1.0-unit floor alone
  });

  it("reads constraints from both unitPlan and degreeRequirements", () => {
    const reqs = deriveBreadthRequirements(prog([hum], [social]), [], half);
    expect(reqs.map((r) => r.title).sort()).toEqual([
      "Humanities",
      "Social Sciences",
    ]);
  });

  it("omits non-breadth constraints", () => {
    const reqs = deriveBreadthRequirements(prog([hum, levelOnly]), [], half);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].title).toBe("Humanities");
  });
});

describe("nonBreadthConstraints", () => {
  it("returns only the constraints that aren't subject-list breadth", () => {
    expect(nonBreadthConstraints(prog([hum, levelOnly, social]))).toEqual([
      levelOnly,
    ]);
  });
});
