import type { Program, UnitConstraint } from "@/lib/programs";

/**
 * Every degree-level constraint a program carries, from both sources Kuali
 * emits them in: the program's own `unitPlan.constraints` and the faculty
 * `degreeRequirements.constraints`. Breadth and level-floor derivation both
 * start from this list (each keeps the constraints it can parse, surfacing the
 * rest verbatim).
 */
export function programConstraints(program: Program): UnitConstraint[] {
  return [
    ...(program.unitPlan?.constraints ?? []),
    ...(program.degreeRequirements?.constraints ?? []),
  ];
}
