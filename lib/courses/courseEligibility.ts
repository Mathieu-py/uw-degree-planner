/**
 * Single source of truth for "can this course be added, and where?", shared by
 * every add-a-course surface (audit drag highlight, slot picker, term pickers)
 * so they never drift; each maps the verdict onto its own UX.
 *
 * Precedence: already-in-plan, antireqs (block everywhere), prereqs + level +
 * program restriction, then coreqs. Restrictions are "required-aware" — a
 * course the program references isn't blocked by a stale prose restriction
 * (see `programReferenced`).
 */

import { formatCourseCode } from "@/lib/format";
import { cachedExtractCourseCodes } from "@/lib/plan/validate";
import { cachedParsePrereqs } from "@/lib/prereqs/cache";
import { evaluate } from "@/lib/prereqs/satisfied";
import type { ProgramIdentity } from "@/lib/programs";
import type { Course } from "./types";

type CourseEligibilityState = "eligible" | "check" | "ineligible";

export interface CourseEligibilityContext {
  /** Codes completed strictly before the target term (drives prereqs). */
  completed: ReadonlySet<string>;
  /** Codes co-scheduled in the target term (lets coreqs resolve same-term). */
  sameTerm?: ReadonlySet<string>;
  /** Target term's level ("1A".."4B"); omitted for pre-arrival / co-op. */
  level?: string;
  program?: ProgramIdentity;
  /** Codes the student's program references; suppresses stale program blocks. */
  programReferenced: ReadonlySet<string>;
  /** Every code already placed anywhere in the plan (antireqs + duplicate). */
  placedAnywhere: ReadonlySet<string>;
}

export interface CourseEligibilityVerdict {
  state: CourseEligibilityState;
  /** Human-readable explanation(s), most specific first (for tooltips). */
  reasons: string[];
  /** The course is already placed somewhere in the plan. */
  alreadyPlaced: boolean;
  /** Placed antireq codes that collide with this course. */
  antireqConflicts: string[];
  /** A program/faculty restriction confirmed the student is ineligible. */
  blockedByProgram: boolean;
  /** Prereq courses still missing (pass-through for callers' existing hints). */
  missingCourses: string[];
  /** Unresolved free-text / level / program notes (pass-through). */
  rawRequirements: string[];
}

const NONE: string[] = [];

function prereqReasons(missingCourses: string[], raw: string[]): string[] {
  if (missingCourses.length > 0) {
    return [`Needs ${missingCourses.map(formatCourseCode).join(", ")}`];
  }
  if (raw.length > 0) return raw;
  return ["Needs earlier prereqs"];
}

export function evaluateCourseEligibility(
  course: Course,
  ctx: CourseEligibilityContext,
): CourseEligibilityVerdict {
  const code = course.code.toLowerCase();

  // 1. Already in the plan — not a fresh add.
  if (ctx.placedAnywhere.has(code)) {
    return {
      state: "ineligible",
      reasons: ["Already in plan"],
      alreadyPlaced: true,
      antireqConflicts: NONE,
      blockedByProgram: false,
      missingCourses: NONE,
      rawRequirements: NONE,
    };
  }

  // 2. Antireq already placed — can't hold both credit, in any term.
  const antireqConflicts = cachedExtractCourseCodes(course.antireqs)
    .filter((a) => a !== code && ctx.placedAnywhere.has(a))
    .map(formatCourseCode);
  if (antireqConflicts.length > 0) {
    return {
      state: "ineligible",
      reasons: [`Antireq conflict: ${antireqConflicts.join(", ")}`],
      alreadyPlaced: false,
      antireqConflicts,
      blockedByProgram: false,
      missingCourses: NONE,
      rawRequirements: NONE,
    };
  }

  // 3. Prereqs + level + program. A program block is demoted to "check" when
  //    the program references this course (see suppressProgramBlock).
  const suppressProgramBlock = ctx.programReferenced.has(code);
  const pre = evaluate(cachedParsePrereqs(course.prereqs), {
    completed: ctx.completed,
    level: ctx.level,
    program: ctx.program,
    suppressProgramBlock,
  });
  if (!pre.satisfied) {
    return {
      state: "ineligible",
      reasons: prereqReasons(pre.missingCourses, pre.rawRequirements),
      alreadyPlaced: false,
      antireqConflicts: NONE,
      blockedByProgram: pre.blockedByProgram,
      missingCourses: pre.missingCourses,
      rawRequirements: pre.rawRequirements,
    };
  }

  // 4. Coreqs — met same-term or earlier. Advisory only: an unmet coreq is a
  //    "check", never a hard block (it may be added to this term afterward).
  let coreqUnmet = false;
  const coreqReasons: string[] = [];
  if (course.coreqs) {
    const completedWithSame =
      ctx.sameTerm && ctx.sameTerm.size > 0
        ? new Set([...ctx.completed, ...ctx.sameTerm])
        : ctx.completed;
    const co = evaluate(cachedParsePrereqs(course.coreqs), {
      completed: completedWithSame,
      level: ctx.level,
      program: ctx.program,
      suppressProgramBlock,
    });
    if (!co.satisfied) {
      coreqUnmet = true;
      const missing =
        co.missingCourses.length > 0
          ? co.missingCourses.map(formatCourseCode).join(", ")
          : "coreqs not met";
      coreqReasons.push(`Coreq: needs ${missing}`);
    }
  }

  const uncertain = pre.uncertain || coreqUnmet;
  return {
    state: uncertain ? "check" : "eligible",
    reasons: [...pre.rawRequirements, ...coreqReasons],
    alreadyPlaced: false,
    antireqConflicts: NONE,
    blockedByProgram: false,
    missingCourses: pre.missingCourses,
    rawRequirements: pre.rawRequirements,
  };
}
