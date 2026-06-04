import { describe, expect, it } from "vitest";
import type { Program, UnitConstraint } from "@/lib/programs";
import {
  deriveBreadthRequirements,
  nonBreadthConstraints,
  parseBreadthConstraint,
  subjectOf,
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
  it("converts a 1.0-unit breadth note to a 2-course requirement", () => {
    const p = parseBreadthConstraint(hum);
    expect(p).not.toBeNull();
    expect(p?.title).toBe("Humanities");
    expect(p?.need).toBe(2);
    expect(p?.subjects).toEqual(["CLAS", "ENGL", "HIST", "MEDVL", "PHIL"]);
  });

  it("maps 0.5 unit → 1 course and 2.0 units → 4 courses", () => {
    expect(parseBreadthConstraint(fpca)?.need).toBe(1);
    expect(parseBreadthConstraint(social)?.need).toBe(4);
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

describe("subjectOf", () => {
  it("extracts the uppercase subject prefix", () => {
    expect(subjectOf("hist250")).toBe("HIST");
    expect(subjectOf("easia220r")).toBe("EASIA");
    expect(subjectOf("CS246")).toBe("CS");
  });
});

describe("deriveBreadthRequirements", () => {
  it("counts distinct placed courses whose subject is in the list", () => {
    const reqs = deriveBreadthRequirements(prog([hum, social]), [
      "phil100",
      "hist250",
      "econ101",
      "math135", // matches neither group
    ]);
    const humReq = reqs.find((r) => r.title === "Humanities");
    expect(humReq?.placed).toBe(2); // phil100 + hist250
    expect([...(humReq?.satisfiers ?? [])].sort()).toEqual([
      "hist250",
      "phil100",
    ]);
    const socReq = reqs.find((r) => r.title === "Social Sciences");
    expect(socReq?.placed).toBe(1); // econ101
    expect(socReq?.need).toBe(4);
  });

  it("reads constraints from both unitPlan and degreeRequirements", () => {
    const reqs = deriveBreadthRequirements(prog([hum], [social]), []);
    expect(reqs.map((r) => r.title).sort()).toEqual([
      "Humanities",
      "Social Sciences",
    ]);
  });

  it("omits non-breadth constraints", () => {
    const reqs = deriveBreadthRequirements(prog([hum, levelOnly]), []);
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
