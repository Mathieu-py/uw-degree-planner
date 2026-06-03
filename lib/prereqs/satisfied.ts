/**
 * Walk a prereq AST against a student's completed set. Course nodes give
 * definite pass/fail; level and raw-text nodes resolve to "uncertain" so
 * the UI can ask the student to verify them rather than wrongly failing.
 */

import type { ProgramIdentity } from "@/lib/programs";
import type { PrereqNode } from "./parse";
import { matchProgram, parseProgramClause } from "./program";

export interface UserState {
  completed: ReadonlySet<string>;
  level?: string;
  /** Student's program, so program-restriction clauses resolve instead of "check". */
  program?: ProgramIdentity;
  /**
   * Demote a program-restriction "block" to a "check" instead of a hard fail.
   * Set when the student's own program references this course, so a stale prose
   * restriction can't grey it out. Other prereqs still gate normally.
   */
  suppressProgramBlock?: boolean;
}

export interface EligibilityResult {
  satisfied: boolean;
  uncertain: boolean;
  missingCourses: string[];
  rawRequirements: string[];
  blockedByProgram: boolean;
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
      blockedByProgram: false,
    };
  }
  const result = walk(node, state);
  return {
    satisfied: result.satisfied,
    uncertain: result.uncertain,
    missingCourses: [...new Set(result.missing)],
    rawRequirements: [...new Set(result.raw)],
    blockedByProgram: result.blockedByProgram,
  };
}

interface WalkResult {
  satisfied: boolean;
  uncertain: boolean;
  missing: string[];
  raw: string[];
  /** A program restriction in this subtree confirmed the student is ineligible. */
  blockedByProgram: boolean;
}

/**
 * A WalkResult with neutral "satisfied, nothing to report" defaults; pass only
 * the fields that differ. Keeps each `walk` branch to its meaningful deltas.
 */
function res(over: Partial<WalkResult> = {}): WalkResult {
  return {
    satisfied: true,
    uncertain: false,
    missing: [],
    raw: [],
    blockedByProgram: false,
    ...over,
  };
}

function walk(node: PrereqNode, state: UserState): WalkResult {
  switch (node.kind) {
    case "course": {
      const ok = state.completed.has(node.code);
      return ok ? res() : res({ satisfied: false, missing: [node.code] });
    }
    case "level": {
      const gate = `Level at least ${node.minLevel}`;
      // Unknown level → uncertain ("check"); known level → definite, and on a
      // fail we surface the gate so the UI names the level rather than a bare
      // "Missing prereqs".
      if (!state.level) return res({ uncertain: true, raw: [gate] });
      const ok = compareLevel(state.level, node.minLevel) >= 0;
      return res({ satisfied: ok, raw: ok ? [] : [gate] });
    }
    case "program": {
      const verdict = matchProgram(
        parseProgramClause(node.clause),
        state.program ?? null,
      );
      // block → hard fail (surfaced via raw, since there's no missing course to
      // point at); unknown → "check"; allow → pass. suppressProgramBlock demotes
      // a block to "check" (see UserState).
      if (verdict === "block") {
        if (state.suppressProgramBlock) {
          return res({ uncertain: true, raw: [node.clause] });
        }
        return res({
          satisfied: false,
          raw: [node.clause],
          blockedByProgram: true,
        });
      }
      if (verdict === "unknown")
        return res({ uncertain: true, raw: [node.clause] });
      return res();
    }
    case "raw": {
      const text = node.text.trim();
      return text === "" ? res() : res({ uncertain: true, raw: [text] });
    }
    case "and": {
      const child = node.children.map((c) => walk(c, state));
      return res({
        satisfied: child.every((c) => c.satisfied),
        uncertain: child.some((c) => c.uncertain),
        missing: child.flatMap((c) => c.missing),
        raw: child.flatMap((c) => c.raw),
        // Any program block in the conjunction fails it for a program reason.
        blockedByProgram: child.some((c) => c.blockedByProgram),
      });
    }
    case "or": {
      // If any child is definitely satisfied, the OR is satisfied (no asterisk).
      // Otherwise, if any child is uncertain (raw text / unknown level), we
      // bias toward "satisfied + uncertain" rather than failing — the student
      // may still meet the requirement via a route we can't evaluate.
      const child = node.children.map((c) => walk(c, state));
      if (child.some((c) => c.satisfied && !c.uncertain)) return res();
      const anyUncertain = child.some((c) => c.uncertain);
      return res({
        satisfied: anyUncertain,
        uncertain: anyUncertain,
        missing: anyUncertain ? [] : child.flatMap((c) => c.missing),
        raw: child.flatMap((c) => c.raw),
        // Only a definitively-failing OR (no satisfied, no uncertain branch)
        // can be attributed to a program block.
        blockedByProgram:
          !anyUncertain && child.some((c) => c.blockedByProgram),
      });
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
