import { describe, expect, it } from "vitest";
import type { ProgramDetail } from "../scrape/pipeline/shared";
import { buildSpecialization } from "../scrape/pipeline/specializations";

// Same leaf-rule fixture the parser tests use: a single requirements leaf whose
// inner text drives what parseProgramRequirements emits (unverified / freeElectives).
const rule = (inner: string) => `
  <section>
    <header><h2 data-testid="grouping-label"><span>Required Courses</span></h2></header>
    <div><div><ul>
      <li data-test="ruleView-A"><div data-test="ruleView-A-result">${inner}</div></li>
    </ul></div></div>
  </section>`;

const detail = (requirements?: string): ProgramDetail => ({
  pid: "SPEC0",
  code: "AI-SPEC",
  title: "Artificial Intelligence",
  ...(requirements ? { requirements } : {}),
});

const build = (requirements?: string) =>
  buildSpecialization(detail(requirements), "id0001", new Map(), "https://view")
    .spec;

describe("buildSpecialization — surfaces spec-level owed requirements (#123)", () => {
  it("carries an unstructurable scoped rule into unverifiedRequirements", () => {
    // A "from List 2" scope makes this a real gate the parser can't structure —
    // previously discarded, now surfaced so the spec can't read 100% without it.
    const spec = build(rule("Complete 4 approved electives from List 2"));
    expect(spec.unverifiedRequirements).toContain(
      "Complete 4 approved electives from List 2",
    );
  });

  it("records a dropped open free elective in freeElectives (not unverified)", () => {
    // Stored raw so buildProgramAudit can re-surface it only for a parent program
    // that lacks a totalUnits denominator (the conditional the shared spec can't
    // decide on its own).
    const spec = build(rule("Complete 4 approved electives"));
    expect(spec.freeElectives).toContain("Complete 4 approved electives");
    expect(spec.unverifiedRequirements).toBeUndefined();
  });

  it("omits both fields when the parser has nothing owed to surface", () => {
    const spec = build();
    expect(spec.unverifiedRequirements).toBeUndefined();
    expect(spec.freeElectives).toBeUndefined();
  });
});
