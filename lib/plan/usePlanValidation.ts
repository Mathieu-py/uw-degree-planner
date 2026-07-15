"use client";

import { useMemo } from "react";
import type { Course } from "@/lib/courses/types";
import type { LocalPlan } from "@/lib/plan/types";
import {
  issuesBySlot,
  type ValidationIssue,
  validatePlan,
} from "@/lib/plan/validate";

export interface PlanValidation {
  /** Shared `code → Course` lookup, built once per catalog. */
  catalogByCode: Map<string, Course>;
  issues: ValidationIssue[];
  /** `issues` grouped by slot id, the shape the timeline consumes. */
  issuesPerSlot: Map<string, ValidationIssue[]>;
}

/**
 * One validation per plan change, shared by the timeline and audit panel so
 * they can't drift. Each field is memo-stable (safe as effect/memo deps).
 */
export function usePlanValidation(
  plan: LocalPlan | null | undefined,
  catalog: readonly Course[],
): PlanValidation {
  const catalogByCode = useMemo(
    () => new Map(catalog.map((c) => [c.code, c])),
    [catalog],
  );
  const issues = useMemo(
    () => (plan ? validatePlan(plan, catalogByCode) : []),
    [plan, catalogByCode],
  );
  const issuesPerSlot = useMemo(() => issuesBySlot(issues), [issues]);
  return { catalogByCode, issues, issuesPerSlot };
}
