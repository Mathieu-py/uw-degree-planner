import type { LocalPlan } from "../../plan/types";
import {
  type Program,
  type RuleNode,
  requiredCoursesIn,
  TERM_LETTERS,
  walkRule,
} from "../../programs";
import { compileAudit } from "../compile";
import { computeDegreeProgress } from "../progress";

/** Every rule root of a program (per-term for engineering, else the one tree). */
export function ruleRoots(p: Program): RuleNode[] {
  return p.kind === "engineering"
    ? TERM_LETTERS.map((t) => p.terms[t]).filter(Boolean)
    : [p.rules];
}

/** Every course code named by any `courses` leaf, deduped. */
export function allCodes(p: Program): string[] {
  const out = new Set<string>();
  for (const r of ruleRoots(p))
    walkRule(r, (n) => {
      if (n.kind === "courses") for (const c of n.courses) out.add(c);
    });
  return [...out];
}

/** Only the all-required course codes (no pick options), deduped. */
export function requiredOnly(p: Program): string[] {
  const out = new Set<string>();
  for (const r of ruleRoots(p))
    for (const c of requiredCoursesIn(r)) out.add(c);
  return [...out];
}

/** Deterministic non-uniform unit weights (0.25/0.5/1.0) — exercises the unit
 *  math a flat 0.5 default can't reach (fractional labs, full-year courses). */
export function mixedUnitsOf(code: string): number {
  return [0.25, 0.5, 1][(code.charCodeAt(0) + code.length) % 3];
}

/** Single-slot plan holding `codes`, for compile+progress harnesses. */
export function makePlan(codes: string[]): LocalPlan {
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

/** Compile + score a plan against a program, treating every course as 0.5 unit. */
export function progressOf(
  program: Program,
  codes: string[],
  unitsOf: (code: string) => number = () => 0.5,
  legality: ReadonlySet<string> = new Set(),
  acknowledged: ReadonlySet<string> = new Set(),
  specUnverified: readonly string[] = [],
) {
  const plan = makePlan(codes);
  const audit = compileAudit(
    program,
    plan,
    null,
    legality,
    null,
    undefined,
    unitsOf,
  );
  // Mirror buildProgramAudit: pass the pre-merged (program + spec) owed list.
  const owed = [
    ...new Set([...(program.unverifiedRequirements ?? []), ...specUnverified]),
  ];
  return computeDegreeProgress(
    audit,
    program,
    unitsOf,
    legality,
    undefined,
    acknowledged,
    undefined,
    owed,
  );
}
