/**
 * Walk a prereq AST against a student's completed set. Course nodes give
 * definite pass/fail; level and raw-text nodes resolve to "uncertain" (ask the
 * student to verify) rather than wrongly failing.
 */

import type { ProgramIdentity } from "@/lib/programs";
import type { PrereqNode } from "./parse";
import { matchProgram, parseProgramClause } from "./program";

export interface UserState {
  completed: ReadonlySet<string>;
  level?: string;
  /**
   * Student's program(s) — double degree carries more than one. A restriction
   * clause is judged per-program then merged asymmetrically (see `walk`'s
   * "program" case): allow-lists most-permissive, negated exclusions
   * most-restrictive. Empty/omitted → no identity (usually "check").
   */
  programs?: ProgramIdentity[];
  /**
   * Demote a program-restriction "block" to a "check": set when the student's
   * program references this course, so a stale prose restriction can't grey it
   * out. Other prereqs still gate.
   */
  suppressProgramBlock?: boolean;
  /**
   * Treat a not-yet-completed course as "uncertain" (completable), not a hard
   * miss. Set only by `isProgramBlocked` to test whether a program/faculty
   * restriction is an UNCONDITIONAL wall — an OR'd course alternative ("X
   * students only OR CS 135") must not read as blocked.
   */
  assumeCoursesUncertain?: boolean;
  /**
   * Courses co-scheduled in the same term. A `coreqOf` is satisfiable by
   * completion OR concurrent enrollment, so its inner requirement is judged
   * against `completed ∪ concurrent`. Set by the planner (knows term placement);
   * absent elsewhere, where a `coreqOf` stays "uncertain" not a false miss.
   */
  concurrent?: ReadonlySet<string>;
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

/** A WalkResult with neutral "satisfied, nothing to report" defaults; override only the differing fields. */
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
      if (ok) return res();
      // assumeCoursesUncertain: completable → "uncertain" not a miss, so an
      // OR'd course alternative isn't read as blocked.
      if (state.assumeCoursesUncertain) return res({ uncertain: true });
      return res({ satisfied: false, missing: [node.code] });
    }
    case "level": {
      const gate = `Level at least ${node.minLevel}`;
      // Unknown level → "check". Known is definite; on fail, surface the gate so
      // the UI names the level, not a bare "Missing prereqs".
      if (!state.level) return res({ uncertain: true, raw: [gate] });
      const ok = compareLevel(state.level, node.minLevel) >= 0;
      return res({ satisfied: ok, raw: ok ? [] : [gate] });
    }
    case "program": {
      const clause = parseProgramClause(node.clause);
      const ids = state.programs ?? [];
      const verdicts = ids.length
        ? ids.map((p) => matchProgram(clause, p))
        : [matchProgram(clause, null)];
      // Asymmetric merge of per-program verdicts (a double degree is enrolled in
      // each of its programs):
      //  - Allow-list ("… students only"): MOST-PERMISSIVE (allow > unknown >
      //    block) — open to one side ⇒ open to the student.
      //  - Negated ("Not open to … Faculty of X …"): MOST-RESTRICTIVE (block >
      //    unknown > allow) — enrolled on the excluded side ⇒ caught.
      // Source: UW Kuali-CM "How to build course requisites" + uwaterloo.ca New
      // Math Students "Double Degree" (must satisfy *both* faculties). matchProgram
      // returns "unknown" → check when unsure.
      const verdict = clause.negated
        ? verdicts.includes("block")
          ? "block"
          : verdicts.includes("unknown")
            ? "unknown"
            : "allow"
        : verdicts.includes("allow")
          ? "allow"
          : verdicts.includes("unknown")
            ? "unknown"
            : "block";
      // block → hard fail (via raw); unknown → "check"; allow → pass.
      // suppressProgramBlock demotes a block to "check".
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
    case "coreqOf": {
      // Coreq satisfied by completing the inner requirement OR concurrent
      // enrollment. With same-term context (planner), fold `concurrent` into
      // `completed` and judge definitively. Without it, a not-yet-completed coreq
      // is "uncertain" — never a false miss that would swallow an OR sibling.
      if (!state.concurrent) {
        const done = walk(node.child, state);
        return done.satisfied && !done.uncertain
          ? res()
          : res({ uncertain: true, raw: done.raw });
      }
      return walk(node.child, {
        ...state,
        completed: new Set([...state.completed, ...state.concurrent]),
      });
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
      // Any definite child satisfies the OR. Else if any is uncertain, bias to
      // "satisfied + uncertain" — may be met via a route we can't see.
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
    case "countOf": {
      // "N of the following". ≥ n definite (satisfied, not uncertain) → met.
      // Else if definite + uncertain could still reach n, bias to satisfied +
      // uncertain (as `or`). Only a shortfall with no uncertain top-up is a miss.
      const child = node.children.map((c) => walk(c, state));
      const definite = child.filter((c) => c.satisfied && !c.uncertain).length;
      if (definite >= node.n) return res();
      const uncertainCount = child.filter((c) => c.uncertain).length;
      const reachable = definite + uncertainCount >= node.n;
      return res({
        satisfied: reachable,
        uncertain: reachable,
        // On a hard shortfall, surface unmet children's missing courses; else
        // nothing is owed yet.
        missing: reachable ? [] : child.flatMap((c) => c.missing),
        raw: child.flatMap((c) => c.raw),
        blockedByProgram: !reachable && child.some((c) => c.blockedByProgram),
      });
    }
  }
}

/**
 * The minimum student level `node` UNCONDITIONALLY requires, or null when a
 * choice of branches avoids every gate. Structural (ignores completion): the
 * planner badges a below-level term without misreading a gate that's only one
 * OR alternative — "VCULT 101 or Level 2A" needs no level (take VCULT 101),
 * "CS 246 and Level 3A" needs 3A. Replaces scanning the "Level at least X"
 * display string, which leaked gates from uncertainty-biased ORs (validate.ts).
 */
export function minimumRequiredLevel(
  node: PrereqNode | null | undefined,
): string | null {
  if (!node) return null;
  switch (node.kind) {
    case "level":
      return node.minLevel;
    case "and": {
      // Every child must hold → the strictest child's gate binds.
      let max: string | null = null;
      for (const c of node.children) {
        const lvl = minimumRequiredLevel(c);
        if (lvl !== null && (max === null || compareLevel(lvl, max) > 0))
          max = lvl;
      }
      return max;
    }
    case "or": {
      // One child suffices → the laxest gate binds; a level-free alternative
      // means no level is required at all.
      let min: string | null = null;
      for (const c of node.children) {
        const lvl = minimumRequiredLevel(c);
        if (lvl === null) return null;
        if (min === null || compareLevel(lvl, min) < 0) min = lvl;
      }
      return min;
    }
    case "countOf": {
      // The student picks the n easiest children: level-free ones first, then
      // ascending gates — the n-th pick's gate binds.
      const lvls = node.children.map((c) => minimumRequiredLevel(c));
      const free = lvls.filter((l) => l === null).length;
      if (free >= node.n) return null;
      const sorted = lvls
        .filter((l): l is string => l !== null)
        .sort(compareLevel);
      return sorted[node.n - free - 1];
    }
    case "coreqOf":
      // Concurrent enrollment doesn't waive a level gate inside the requirement.
      return minimumRequiredLevel(node.child);
    default:
      // course / program / raw carry no level constraint.
      return null;
  }
}

/** UWaterloo year-letter levels: "1A" < "1B" < "2A" < ... < "4B" < "5A". */
export function compareLevel(a: string, b: string): number {
  const score = (lvl: string) => {
    const m = lvl.match(/^(\d+)([A-Z])?$/);
    if (!m) return 0;
    const year = parseInt(m[1], 10);
    const term = m[2] === "B" ? 1 : 0;
    return year * 2 + term;
  };
  return score(a.toUpperCase()) - score(b.toUpperCase());
}
