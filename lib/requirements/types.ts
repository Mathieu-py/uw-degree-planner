import { z } from "zod";

/**
 * Recursive AST for program requirements: a discriminated union walkable via
 * `walkRule`, with `z.lazy` for the self-reference. `subjectPool.selectCount`
 * is exactly-N (no range), since Kuali emits pools only as "Complete N
 * additional <SUBJECT> courses".
 */
export const RuleNodeSchema: z.ZodType<RuleNode> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("all"),
      description: z.string().optional(),
      children: z.array(RuleNodeSchema),
    }),
    z.object({
      kind: z.literal("pick"),
      description: z.string().optional(),
      selectMin: z.number().int().positive().optional(),
      selectMax: z.number().int().positive().optional(),
      children: z.array(RuleNodeSchema),
    }),
    z.object({
      kind: z.literal("subjectPool"),
      description: z.string().optional(),
      /**
       * Course count to pick. Approximate (units ÷ 0.5) when the source stated
       * the pool in units ("5.25 units of Science courses"), so it can be a
       * half-integer (0.5) — not necessarily a whole count. Display/fallback only
       * when `needUnits` is set (the audit then scores by units).
       */
      selectCount: z.number().positive().multipleOf(0.5),
      /**
       * The real unit requirement when the source stated the pool in UNITS
       * ("2.0 units of Science courses"): the audit scores by units (a 1.0-unit
       * course counts as 1.0, not one 0.5 slot), making `selectCount` display-only.
       * Absent for count-stated pools ("2 CS courses"), which gate on `selectCount`.
       */
      needUnits: z.number().positive().optional(),
      subjectCodes: z.array(z.string()).min(1),
      minLevel: z.number().int().positive().optional(),
      maxLevel: z.number().int().positive().optional(),
      exclusions: z.array(z.string()).min(1).optional(),
    }),
    z.object({
      kind: z.literal("courses"),
      courses: z.array(z.string()).min(1),
    }),
    z.object({
      kind: z.literal("excluded"),
      description: z.string().optional(),
      courses: z.array(z.string()).min(1),
    }),
  ]),
);

export type RuleNode =
  | { kind: "all"; description?: string; children: RuleNode[] }
  | {
      kind: "pick";
      description?: string;
      selectMin?: number;
      selectMax?: number;
      children: RuleNode[];
    }
  | {
      kind: "subjectPool";
      description?: string;
      selectCount: number;
      needUnits?: number;
      subjectCodes: string[];
      minLevel?: number;
      maxLevel?: number;
      exclusions?: string[];
    }
  | { kind: "courses"; courses: string[] }
  | { kind: "excluded"; description?: string; courses: string[] };

export type SubjectPoolNode = Extract<RuleNode, { kind: "subjectPool" }>;
