import { describe, expect, it } from "vitest";
import { equivalenceForCatalog } from "../../courses/equivalence";
import type { LocalPlan } from "../../plan/types";
import type { Program } from "../../programs";
import { compileAudit } from "../compile";

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

// AMATH242 and CS371 are the same course, cross-listed (GitHub #21).
const equiv = equivalenceForCatalog([
  { code: "amath242", crossListed: ["cs371"] },
  { code: "cs371", crossListed: ["amath242"] },
]);

const program: Program = {
  kind: "flexible",
  name: "Toy",
  asOf: "2026",
  rules: {
    kind: "all",
    children: [{ kind: "courses", courses: ["amath242"] }],
  },
};

describe("compileAudit — course equivalence", () => {
  it("credits a required code via a placed cross-listed equivalent", () => {
    const plan = makePlan(["cs371"]); // student took the CS-listed twin
    const audit = compileAudit(program, plan, null, new Set(), null, equiv);
    expect(audit.flexibleRoot?.status).toBe("met");
    expect(audit.flexibleRoot?.satisfiers.map((s) => s.code)).toEqual([
      "cs371",
    ]);
    expect(audit.flexibleRoot?.missingCodes).toEqual([]);
  });

  it("does not match without an equivalence index (exact-code only)", () => {
    const plan = makePlan(["cs371"]);
    const audit = compileAudit(program, plan); // no equiv
    expect(audit.flexibleRoot?.status).toBe("unmet");
    expect(audit.flexibleRoot?.missingCodes).toEqual(["amath242"]);
  });

  it("never injects the equivalent into the placement map (no double count)", () => {
    const plan = makePlan(["cs371"]);
    const audit = compileAudit(program, plan, null, new Set(), null, equiv);
    // Only the real placed code is in the map; the satisfier is that one
    // placement, so a downstream unit sum counts it exactly once.
    expect([...audit.placement.keys()]).toEqual(["cs371"]);
    expect(audit.flexibleRoot?.satisfiers).toHaveLength(1);
  });

  it("still credits a direct exact-code placement", () => {
    const plan = makePlan(["amath242"]);
    const audit = compileAudit(program, plan, null, new Set(), null, equiv);
    expect(audit.flexibleRoot?.status).toBe("met");
    expect(audit.flexibleRoot?.satisfiers.map((s) => s.code)).toEqual([
      "amath242",
    ]);
  });
});
