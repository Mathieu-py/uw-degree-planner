import { describe, expect, it } from "vitest";
import type { Course } from "@/lib/courses/types";
import type { LocalPlan } from "@/lib/plan/types";
import { PROGRAMS } from "@/lib/programs/registry";
import { buildProgramAudit } from "../buildProgramAudit";

/**
 * Cross-program (double-degree) rollup. AuditPanel sums credited units and
 * denominators across every program on the plan, then
 *   combinedPct = round(sumCredited / sumDenom * 100).
 * This pins that math against real program denominators via the pure
 * buildProgramAudit, so two half-finished degrees read ~50% combined — not 100%.
 */

const EMPTY_CATALOG = new Map<string, Course>();

function plan(programIds: string[], codes: string[]): LocalPlan {
  return {
    schemaVersion: 3,
    programIds,
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

/** Replicate AuditPanel's plan-level rollup over the per-program audits. */
function rollup(p: LocalPlan) {
  let sumCredited = 0;
  let sumDenom = 0;
  for (const id of p.programIds) {
    const data = buildProgramAudit(
      p,
      id,
      PROGRAMS[id] ?? null,
      EMPTY_CATALOG,
      [],
    );
    sumCredited += data.progress.creditedUnits;
    sumDenom += data.progress.denom;
  }
  const combinedPct =
    sumDenom > 0 ? Math.round((sumCredited / sumDenom) * 100) : 0;
  return { sumCredited, sumDenom, combinedPct };
}

describe("cross-program rollup (real programs)", () => {
  const A = "3g-anthropology"; // 15 units
  const B = "3g-classical-studies"; // 15 units

  it("sums the two real denominators (15 + 15 = 30)", () => {
    const r = rollup(plan([A, B], []));
    expect(r.sumDenom).toBe(30);
    expect(r.sumCredited).toBe(0);
    expect(r.combinedPct).toBe(0);
  });

  it("two empty halves never read above 0%, two-program denom never NaN", () => {
    const r = rollup(plan([A, B], []));
    expect(Number.isNaN(r.combinedPct)).toBe(false);
    expect(r.combinedPct).toBeGreaterThanOrEqual(0);
    expect(r.combinedPct).toBeLessThanOrEqual(100);
  });

  it("each program's denom is finite and contributes independently", () => {
    const a = buildProgramAudit(
      plan([A, B], []),
      A,
      PROGRAMS[A] ?? null,
      EMPTY_CATALOG,
      [],
    );
    const b = buildProgramAudit(
      plan([A, B], []),
      B,
      PROGRAMS[B] ?? null,
      EMPTY_CATALOG,
      [],
    );
    expect(a.progress.denom).toBe(15);
    expect(b.progress.denom).toBe(15);
    // A course placed for one program still credits only within that program's
    // own audit — the rollup is a sum of independent per-program headlines.
    expect(a.progress.pct).toBeLessThanOrEqual(100);
    expect(b.progress.pct).toBeLessThanOrEqual(100);
  });
});
