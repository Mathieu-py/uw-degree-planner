/**
 * Walk a prereq AST against a student's completed set. Course nodes give
 * definite pass/fail; level and raw-text nodes resolve to "uncertain" so
 * the UI can ask the student to verify them rather than wrongly failing.
 */

import type { PrereqNode } from "./parse";

export interface UserState {
  completed: ReadonlySet<string>;
  level?: string;
}

export interface EligibilityResult {
  satisfied: boolean;
  uncertain: boolean;
  missingCourses: string[];
  rawRequirements: string[];
}

export function evaluate(
  node: PrereqNode | null,
  state: UserState,
): EligibilityResult {
  if (!node) {
    return {
      satisfied: true,
      uncertain: false,
      missingCourses: [],
      rawRequirements: [],
    };
  }
  const result = walk(node, state);
  return {
    satisfied: result.satisfied,
    uncertain: result.uncertain,
    missingCourses: [...new Set(result.missing)],
    rawRequirements: [...new Set(result.raw)],
  };
}

interface WalkResult {
  satisfied: boolean;
  uncertain: boolean;
  missing: string[];
  raw: string[];
}

function walk(node: PrereqNode, state: UserState): WalkResult {
  switch (node.kind) {
    case "course": {
      const ok = state.completed.has(node.code);
      return {
        satisfied: ok,
        uncertain: false,
        missing: ok ? [] : [node.code],
        raw: [],
      };
    }
    case "level": {
      if (!state.level) {
        return {
          satisfied: true,
          uncertain: true,
          missing: [],
          raw: [`Level at least ${node.minLevel}`],
        };
      }
      return {
        satisfied: compareLevel(state.level, node.minLevel) >= 0,
        uncertain: false,
        missing: [],
        raw: [],
      };
    }
    case "raw": {
      const text = node.text.trim();
      if (text === "") {
        return { satisfied: true, uncertain: false, missing: [], raw: [] };
      }
      return { satisfied: true, uncertain: true, missing: [], raw: [text] };
    }
    case "and": {
      const child = node.children.map((c) => walk(c, state));
      return {
        satisfied: child.every((c) => c.satisfied),
        uncertain: child.some((c) => c.uncertain),
        missing: child.flatMap((c) => c.missing),
        raw: child.flatMap((c) => c.raw),
      };
    }
    case "or": {
      // If any child is definitely satisfied, the OR is satisfied (no asterisk).
      // Otherwise, if any child is uncertain (raw text / unknown level), we
      // bias toward "satisfied + uncertain" rather than failing — the student
      // may still meet the requirement via a route we can't evaluate.
      const child = node.children.map((c) => walk(c, state));
      const anySatisfied = child.some((c) => c.satisfied && !c.uncertain);
      if (anySatisfied) {
        return { satisfied: true, uncertain: false, missing: [], raw: [] };
      }
      const anyUncertain = child.some((c) => c.uncertain);
      return {
        satisfied: anyUncertain,
        uncertain: anyUncertain,
        missing: anyUncertain ? [] : child.flatMap((c) => c.missing),
        raw: child.flatMap((c) => c.raw),
      };
    }
  }
}

/** UWaterloo year-letter levels: "1A" < "1B" < "2A" < ... < "4B" < "5A". */
function compareLevel(a: string, b: string): number {
  const score = (lvl: string) => {
    const m = lvl.match(/^(\d+)([A-Z])?$/);
    if (!m) return 0;
    const year = parseInt(m[1], 10);
    const term = m[2] === "B" ? 1 : 0;
    return year * 2 + term;
  };
  return score(a.toUpperCase()) - score(b.toUpperCase());
}
