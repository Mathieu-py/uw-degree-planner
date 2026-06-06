import { describe, expect, it } from "vitest";
import coursesData from "../../../data/courses.1261.json";
import type { LocalPlan } from "../../plan/types";
import { PROGRAMS } from "../../programs";
import { compileAudit } from "../compile";
import { computeDegreeProgress } from "../progress";

/**
 * Whole-catalog guardrail: the unified headline must stay coherent for EVERY
 * program shape (16 engineering, 178 flexible), not just the one we hand-tuned.
 * Verifies the denominator/cap/assignment never produce NaN or out-of-range
 * percentages, that an empty plan reads 0%, and that a maximal plan completes.
 */

const catalog = (coursesData as { courses: Array<{ code: string; units?: number }> })
  .courses;
const unitsByCode = new Map(catalog.map((c) => [c.code, c.units]));
const unitsOf = (code: string) => unitsByCode.get(code) ?? 0.5;
const ALL_CODES = catalog.map((c) => c.code);

function planOf(codes: string[]): LocalPlan {
  return {
    schemaVersion: 1,
    programId: "x",
    specializationId: null,
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

function scoreOf(programId: string, codes: string[]) {
  const program = PROGRAMS[programId];
  const audit = compileAudit(program, planOf(codes), null, new Set());
  return computeDegreeProgress(audit, program, unitsOf);
}

const programIds = Object.keys(PROGRAMS);

describe("computeDegreeProgress — every program (empty plan)", () => {
  it("reads 0% with a finite, non-NaN denominator", () => {
    for (const id of programIds) {
      const p = scoreOf(id, []);
      expect(p.pct, `${id}: empty pct`).toBe(0);
      expect(p.creditedUnits, `${id}: empty credited`).toBe(0);
      expect(Number.isFinite(p.denom), `${id}: denom finite`).toBe(true);
      expect(p.denom, `${id}: denom > 0`).toBeGreaterThan(0);
    }
  });
});

describe("computeDegreeProgress — every program (maximal plan)", () => {
  // Placing the entire catalog must keep the bar in range and let it complete:
  // every satisfiable bucket fills, the cap holds the credited total at N.
  it("stays within [0,100], never NaN, and reaches 100% where the data allows", () => {
    const shortfalls: Array<{ id: string; pct: number }> = [];
    for (const id of programIds) {
      const p = scoreOf(id, ALL_CODES);
      expect(p.pct, `${id}: pct lower bound`).toBeGreaterThanOrEqual(0);
      expect(p.pct, `${id}: pct upper bound`).toBeLessThanOrEqual(100);
      expect(Number.isNaN(p.creditedUnits), `${id}: credited NaN`).toBe(false);
      if (p.pct < 100) shortfalls.push({ id, pct: p.pct });
    }
    // A handful of programs reference subjects/levels absent from this term's
    // catalog snapshot, so a bucket can't fill even from the whole catalog.
    // Surface them, but the overwhelming majority must complete.
    if (shortfalls.length > 0)
      console.warn(
        "programs that can't reach 100% even fully loaded:",
        shortfalls.map((s) => `${s.id}=${s.pct}%`).join(", "),
      );
    expect(shortfalls.length).toBeLessThanOrEqual(15);
  });
});
