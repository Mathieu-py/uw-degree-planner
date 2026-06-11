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
  /**
   * Student's program(s) — a double degree carries more than one. A restriction
   * clause is judged against each, then merged asymmetrically (see the
   * "program" case in `walk`): allow-lists take the most-permissive verdict, a
   * negated "Not open to …" exclusion takes the most-restrictive. Empty/omitted
   * → judged with no identity (usually "check").
   */
  programs?: ProgramIdentity[];
  /**
   * Demote a program-restriction "block" to a "check". Set when the student's
   * program references this course, so a stale prose restriction can't grey it
   * out. Other prereqs still gate normally.
   */
  suppressProgramBlock?: boolean;
  /**
   * Treat a not-yet-completed course as "uncertain" (completable) instead of a
   * hard miss. Set only by `isProgramBlocked`, which asks whether a program/
   * faculty restriction is an UNCONDITIONAL wall: a requirement the student
   * could satisfy by taking a course isn't, so an OR'd course alternative
   * ("X students only OR CS 135") must not be reported as blocked.
   */
  assumeCoursesUncertain?: boolean;
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
      if (ok) return res();
      // A completable course is "uncertain" rather than a hard miss when asked
      // (isProgramBlocked) — so an OR'd course alternative isn't read as blocked.
      if (state.assumeCoursesUncertain) return res({ uncertain: true });
      return res({ satisfied: false, missing: [node.code] });
    }
    case "level": {
      const gate = `Level at least ${node.minLevel}`;
      // Unknown level → "check". Known level is definite; on a fail we surface
      // the gate so the UI names the level, not a bare "Missing prereqs".
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
      // Merging the per-program verdicts is asymmetric, grounded in how UW
      // writes enrolment restrictions for double-degree students:
      //  - Allow-list ("… students only"): MOST-PERMISSIVE (allow > unknown >
      //    block). A double degree is "enrolled in" each of its programs, so a
      //    course open to one side is open to the student.
      //  - Negated ("Not open to students enrolled in Faculty of X programs"):
      //    MOST-RESTRICTIVE (block > unknown > allow). The student is enrolled
      //    in a Faculty-of-X program on the excluded side, so the exclusion
      //    catches them even though their other degree wouldn't be excluded.
      // Source: UW Kuali-CM "How to build course requisites" (standard
      // exclusion wording) + uwaterloo.ca New Math Students "Double Degree"
      // (double-degree students must satisfy the requirements of *both*
      // faculties). When unsure, matchProgram already returns "unknown" → check.
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
      // block → hard fail (via raw, no missing course to point at); unknown →
      // "check"; allow → pass. suppressProgramBlock demotes a block to "check".
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
      // Any definitely-satisfied child satisfies the OR. Otherwise, if any is
      // uncertain (raw text / unknown level), bias to "satisfied + uncertain"
      // rather than fail — the student may meet it via a route we can't see.
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
      // "N of the following". Definite passes are children satisfied without
      // uncertainty. If ≥ n are definite, met. Otherwise, if the definite passes
      // plus the uncertain children could still reach n, bias to satisfied +
      // uncertain (same "completable via an unseen route" logic as `or`). Only a
      // shortfall with no uncertain top-up is a hard miss.
      const child = node.children.map((c) => walk(c, state));
      const definite = child.filter((c) => c.satisfied && !c.uncertain).length;
      if (definite >= node.n) return res();
      const uncertainCount = child.filter((c) => c.uncertain).length;
      const reachable = definite + uncertainCount >= node.n;
      return res({
        satisfied: reachable,
        uncertain: reachable,
        // On a hard shortfall, surface the unmet children's missing courses so
        // the student sees concrete options; otherwise nothing is owed yet.
        missing: reachable ? [] : child.flatMap((c) => c.missing),
        raw: child.flatMap((c) => c.raw),
        blockedByProgram: !reachable && child.some((c) => c.blockedByProgram),
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
