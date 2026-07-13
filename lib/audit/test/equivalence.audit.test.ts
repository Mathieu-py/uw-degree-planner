import { describe, expect, it } from "vitest";
import { equivalenceForCatalog } from "../../courses/equivalence";
import type { LocalPlan } from "../../plan/types";
import type { Program } from "../../programs";
import { compileAudit } from "../compile";
import { computeDegreeProgress } from "../progress";
import { ringFor, scoreAudit, scoreNode } from "../score";

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

// AMATH242 and CS371 are the same course, cross-listed.
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

describe("compileAudit — option lists naming both twins (no double count)", () => {
  it("counts one placement ONCE in a pick pool listing both twin codes", () => {
    // "Choose 2 of: AMATH 242, CS 371, STAT 230" — the first two are the same
    // course, so placing CS 371 alone fills ONE slot, not two.
    const pickProgram: Program = {
      kind: "flexible",
      name: "Toy",
      asOf: "2026",
      rules: {
        kind: "all",
        children: [
          {
            kind: "pick",
            selectMin: 2,
            selectMax: 2,
            children: [
              {
                kind: "courses",
                courses: ["amath242", "cs371", "stat230"],
              },
            ],
          },
        ],
      },
    };
    const plan = makePlan(["cs371"]);
    const audit = compileAudit(pickProgram, plan, null, new Set(), null, equiv);
    const pick = audit.flexibleRoot?.children[0];
    expect(pick?.satisfiedCount).toBe(1);
    expect(pick?.status).toBe("partial");
  });

  it("never reports overSatisfied from a single placement matching twin options", () => {
    // "Choose 1 of: AMATH 242, CS 371" (selectMax 1) — one placement is
    // exactly met, not 2 > selectMax.
    const pickProgram: Program = {
      kind: "flexible",
      name: "Toy",
      asOf: "2026",
      rules: {
        kind: "all",
        children: [
          {
            kind: "pick",
            selectMin: 1,
            selectMax: 1,
            children: [{ kind: "courses", courses: ["amath242", "cs371"] }],
          },
        ],
      },
    };
    const plan = makePlan(["amath242"]);
    const audit = compileAudit(pickProgram, plan, null, new Set(), null, equiv);
    expect(audit.flexibleRoot?.children[0]?.status).toBe("met");
    expect(audit.flexibleRoot?.children[0]?.satisfiedCount).toBe(1);
  });

  it("treats an all-required leaf naming both twins as ONE distinct course", () => {
    const leafProgram: Program = {
      kind: "flexible",
      name: "Toy",
      asOf: "2026",
      rules: {
        kind: "all",
        children: [{ kind: "courses", courses: ["amath242", "cs371"] }],
      },
    };
    const plan = makePlan(["cs371"]);
    const audit = compileAudit(leafProgram, plan, null, new Set(), null, equiv);
    expect(audit.flexibleRoot?.status).toBe("met");
    expect(audit.flexibleRoot?.satisfiers).toHaveLength(1);
  });
});

describe("computeDegreeProgress — course equivalence", () => {
  const unitsOf = () => 0.5;

  it("fills a required-course bucket with the placed cross-listed twin", () => {
    // Without equiv, the audit row says "met" (compileAudit credits the twin)
    // while the headline bucket stays unfilled and pct is capped below 100 —
    // the two passes MUST share the index.
    const plan = makePlan(["cs371"]);
    const audit = compileAudit(program, plan, null, new Set(), null, equiv);
    const progress = computeDegreeProgress(
      audit,
      program,
      unitsOf,
      new Set(),
      equiv,
    );
    expect(progress.allComplete).toBe(true);
    expect(progress.creditedUnits).toBe(0.5);
    expect(progress.pct).toBe(100);
  });

  it("under-credits when the index is withheld (regression guard)", () => {
    const plan = makePlan(["cs371"]);
    const audit = compileAudit(program, plan, null, new Set(), null, equiv);
    const progress = computeDegreeProgress(audit, program, unitsOf, new Set());
    expect(progress.allComplete).toBe(false);
    expect(progress.pct).toBeLessThan(100);
  });

  it("treats an all-required leaf naming both twins as ONE bucket", () => {
    // Mirrors the compileAudit case above: a leaf "AMATH 242, CS 371" is one
    // course, so one placement completes it. Without class collapse the headline
    // would push two singleton buckets and stay below 100 while the tree is met.
    const leafProgram: Program = {
      kind: "flexible",
      name: "Toy",
      asOf: "2026",
      rules: {
        kind: "all",
        children: [{ kind: "courses", courses: ["amath242", "cs371"] }],
      },
    };
    const plan = makePlan(["cs371"]);
    const audit = compileAudit(leafProgram, plan, null, new Set(), null, equiv);
    const progress = computeDegreeProgress(
      audit,
      leafProgram,
      unitsOf,
      new Set(),
      equiv,
    );
    expect(progress.allComplete).toBe(true);
    expect(progress.creditedUnits).toBe(0.5);
    expect(progress.pct).toBe(100);

    // The panel must agree: before the summarize fix, `needed` used
    // r.courses.length, so this met leaf showed a 1/2 ring (and the group stuck
    // below 100%) on both the local (no-progress) and match-scored views.
    const root = audit.flexibleRoot;
    if (!root) throw new Error("expected a flexible root");
    const local = scoreNode(root.children[0]);
    expect({ needed: local.needed, satisfied: local.credit }).toEqual({
      needed: 1,
      satisfied: 1,
    });
    const scored = scoreAudit(audit, progress);
    const leaf = scored.flexible?.children[0];
    expect({ needed: leaf?.needed, satisfied: leaf?.credit }).toEqual({
      needed: 1,
      satisfied: 1,
    });
    if (!scored.flexible) throw new Error("expected a scored flexible root");
    expect(ringFor(scored.flexible).pct).toBe(100);
  });
});
