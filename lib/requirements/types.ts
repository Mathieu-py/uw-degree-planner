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
      selectMin: z.number().optional(),
      selectMax: z.number().optional(),
      children: z.array(RuleNodeSchema),
    }),
    z.object({
      kind: z.literal("subjectPool"),
      description: z.string().optional(),
      /**
       * Course count to pick. Approximate (units ÷ 0.5) when the source stated
       * the pool in units ("5.25 units of Science courses").
       */
      selectCount: z.number(),
      subjectCodes: z.array(z.string()),
      minLevel: z.number().optional(),
      maxLevel: z.number().optional(),
      exclusions: z.array(z.string()).optional(),
    }),
    z.object({
      kind: z.literal("courses"),
      courses: z.array(z.string()),
    }),
    z.object({
      kind: z.literal("excluded"),
      description: z.string().optional(),
      courses: z.array(z.string()),
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
      subjectCodes: string[];
      minLevel?: number;
      maxLevel?: number;
      exclusions?: string[];
    }
  | { kind: "courses"; courses: string[] }
  | { kind: "excluded"; description?: string; courses: string[] };

export type SubjectPoolNode = Extract<RuleNode, { kind: "subjectPool" }>;
