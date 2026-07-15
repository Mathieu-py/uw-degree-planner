import { describe, expect, it } from "vitest";
import coursesData from "../../../data/courses.1261.json";
import type { LocalPlan } from "../../plan/types";
import { PROGRAMS } from "../../programs/registry";
import { compileAudit } from "../compile";
import { computeDegreeProgress } from "../progress";

/**
 * Whole-catalog guardrail: the unified headline must stay coherent for EVERY
 * program shape (16 engineering, 178 flexible), not just the one we hand-tuned.
 * Verifies the denominator/cap/assignment never produce NaN or out-of-range
 * percentages, that an empty plan reads 0%, and that a maximal plan completes.
 */

const catalog = (
  coursesData as { courses: Array<{ code: string; units?: number }> }
).courses;
const unitsByCode = new Map(catalog.map((c) => [c.code, c.units]));
const unitsOf = (code: string) => unitsByCode.get(code) ?? 0.5;
const ALL_CODES = catalog.map((c) => c.code);

function planOf(codes: string[]): LocalPlan {
  return {
    schemaVersion: 3,
    programIds: ["x"],
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
  it("stays in [0,100], never NaN; structured programs complete, unverified cap below 100", () => {
    const structuredShortfalls: Array<{ id: string; pct: number }> = [];
    for (const id of programIds) {
      const p = scoreOf(id, ALL_CODES);
      expect(p.pct, `${id}: pct lower bound`).toBeGreaterThanOrEqual(0);
      expect(p.pct, `${id}: pct upper bound`).toBeLessThanOrEqual(100);
      expect(Number.isNaN(p.creditedUnits), `${id}: credited NaN`).toBe(false);

      // A program with owed requirements the scraper couldn't structure
      // (`unverifiedRequirements`) MUST hold the headline below 100 until they're
      // checked manually — this asserts the safety net actually engages, so the
      // audit can never silently read complete while a real requirement was
      // dropped (the bug this guards against).
      const hasUnverified =
        (PROGRAMS[id].unverifiedRequirements?.length ?? 0) > 0;
      if (hasUnverified) {
        expect(p.pct, `${id}: unverified must cap below 100`).toBeLessThan(100);
      } else if (p.pct < 100) {
        structuredShortfalls.push({ id, pct: p.pct });
      }
    }
    // Every fully-structured program must complete on a maximal plan. A new
    // shortfall is a real requirement-data regression (or a course the snapshot
    // dropped), so fail with the offenders listed rather than absorbing up to N
    // of them behind a tolerance. If a snapshot gap ever makes one legitimately
    // un-completable, add it to an explicit allowlist here — consciously.
    expect(
      structuredShortfalls.map((s) => `${s.id}=${s.pct}%`),
      "structured programs that can't reach 100% even fully loaded",
    ).toEqual([]);
    // Whole catalog × ~194 programs runs ~2s locally; the generous timeout keeps
    // it from flaking on a loaded / over-parallelized runner (a real hang still fails).
  }, 30_000);
});
