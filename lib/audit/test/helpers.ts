import type { LocalPlan } from "../../plan/types";
import type { Program } from "../../programs";
import { compileAudit } from "../compile";
import { computeDegreeProgress } from "../progress";

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
