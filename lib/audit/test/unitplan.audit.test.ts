// Cross-program verification for the unit plans the scraper produces. These
// lock the fidelity guarantees: every bucket is well-formed and carries its
// verbatim source, a program's own buckets never demand more than its stated
// total, and compiling the unit audit over every real program (with an empty
// plan) is a clean, throw-free smoke test that also proves nothing is applied
// before any course is placed.
import { describe, expect, it } from "vitest";
import type { LocalPlan } from "../../plan/types";
import { PROGRAMS } from "../../programs";
import { compileAudit } from "../compile";

const programIds = Object.keys(PROGRAMS);

function emptyPlan(programId: string): LocalPlan {
  return {
    schemaVersion: 1,
    programId,
    specializationId: null,
    stream: "regular",
    startTermId: 1239,
    slots: [],
    updatedAt: "2026-05-23T12:00:00.000Z",
  };
}

describe("unit plans — cross-program fidelity", () => {
  it("covers the full catalog with unit plans", () => {
    const withPlan = programIds.filter((id) => PROGRAMS[id].unitPlan);
    // The vast majority of programs state unit requirements; guard against a
    // regression that silently drops them.
    expect(withPlan.length).toBeGreaterThan(150);
  });

  it.each(
    programIds,
  )("has well-formed unit buckets with verbatim source: %s", (id) => {
    const plan = PROGRAMS[id].unitPlan;
    if (!plan) return;
    for (const b of plan.buckets) {
      expect(b.requiredUnits, `${id}/${b.id}`).toBeGreaterThan(0);
      expect(b.sourceText?.length, `${id}/${b.id} sourceText`).toBeGreaterThan(
        0,
      );
    }
  });

  it.each(
    programIds,
  )("a program's own buckets never exceed its stated total: %s", (id) => {
    const plan = PROGRAMS[id].unitPlan;
    if (!plan?.totalUnits) return;
    const sum = plan.buckets.reduce((s, b) => s + b.requiredUnits, 0);
    // Buckets partition (a subset of) the degree total; they cannot require
    // more units than the whole degree. (Breadth lives on degreeRequirements,
    // not here, so it doesn't inflate this sum.)
    expect(
      sum,
      `${id}: buckets ${sum} > total ${plan.totalUnits}`,
    ).toBeLessThanOrEqual(plan.totalUnits + 0.01);
  });

  it.each(
    programIds,
  )("compiles a unit audit with nothing applied on an empty plan: %s", (id) => {
    const audit = compileAudit(PROGRAMS[id], emptyPlan(id));
    if (!audit.unitAudit) return;
    expect(audit.unitAudit.totalApplied).toBe(0);
    for (const b of audit.unitAudit.buckets)
      expect(b.appliedUnits, `${id}/${b.bucket.id}`).toBe(0);
  });
});
