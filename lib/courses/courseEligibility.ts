/**
 * Single source of truth for "can this course be added, and where?", shared by
 * every add-a-course surface (audit drag highlight, slot/term pickers) so they
 * never drift; each maps the verdict onto its own UX.
 *
 * Precedence: already-in-plan → program/faculty restriction (hard "wrong
 * program", ranked above antireqs) → antireqs (block everywhere) → other
 * prereqs + level → coreqs. Restrictions are "required-aware": a course the
 * program references isn't blocked by a stale prose restriction (see
 * `programReferenced`).
 */

import { formatCourseCode } from "@/lib/format";
import { resolveAntireqCodes } from "@/lib/plan/validate";
import { resolveCoreqs, resolvePrereqs } from "@/lib/prereqs/cache";
import { describeMissingPrereqs } from "@/lib/prereqs/describe";
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
  /** Student's program(s); a double degree has more than one. Most-permissive wins. */
  programs?: ProgramIdentity[];
  /** Codes the student's program references; suppresses stale program blocks. */
  programReferenced: ReadonlySet<string>;
  /** Every code already placed anywhere in the plan (antireqs + duplicate). */
  placedAnywhere: ReadonlySet<string>;
  /**
   * Reverse antireqs: code → placed courses that name it. Flags a candidate when
   * a *placed* course names it even if its own list doesn't reciprocate (UW's
   * "credit not granted for both … a course naming it as such"). Build with
   * {@link placedAntireqNamers}.
   */
  placedAntireqNamers?: ReadonlyMap<string, readonly string[]>;
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
const EMPTY_SET: ReadonlySet<string> = new Set();

function prereqReasons(description: string | null, raw: string[]): string[] {
  if (description) return [`Needs ${description}`];
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

  // 2. Prereqs + level + program. Before antireqs so a program/faculty block (a
  //    hard "wrong program") outranks an antireq conflict; a block demotes to
  //    "check" when the program references this course (suppressProgramBlock).
  const suppressProgramBlock = ctx.programReferenced.has(code);
  const prereqAst = resolvePrereqs(course);
  const pre = evaluate(prereqAst, {
    completed: ctx.completed,
    level: ctx.level,
    programs: ctx.programs,
    suppressProgramBlock,
  });
  // Describe the unmet portion with the SAME context the verdict used, so an OR
  // mixing a course with a level/program branch lists every open alternative
  // (e.g. "one of CS 135, Level at least 3A") rather than just the raw gate.
  const missingDescription = describeMissingPrereqs(prereqAst, ctx.completed, {
    level: ctx.level,
    programs: ctx.programs,
  });
  if (!pre.satisfied && pre.blockedByProgram) {
    // Lead with the restriction prose (in rawRequirements) so a program block
    // reads as "wrong program", not a missing-course "Needs …" — which would
    // otherwise win when the block also has an unmet course alongside it.
    return {
      state: "ineligible",
      reasons:
        pre.rawRequirements.length > 0
          ? pre.rawRequirements
          : prereqReasons(missingDescription, pre.rawRequirements),
      alreadyPlaced: false,
      antireqConflicts: NONE,
      blockedByProgram: true,
      missingCourses: pre.missingCourses,
      rawRequirements: pre.rawRequirements,
    };
  }

  // 3. Antireq already placed — can't hold both credit, in any term. Symmetric:
  //    this course names a placed one, OR a placed one names this course.
  const forwardAnti = resolveAntireqCodes(course).filter(
    (a) => a !== code && ctx.placedAnywhere.has(a),
  );
  const reverseAnti = ctx.placedAntireqNamers?.get(code) ?? [];
  const antireqConflicts = [...new Set([...forwardAnti, ...reverseAnti])].map(
    formatCourseCode,
  );
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

  // 4. Other prereq failure (missing courses / level) — not a program block.
  if (!pre.satisfied) {
    return {
      state: "ineligible",
      reasons: prereqReasons(missingDescription, pre.rawRequirements),
      alreadyPlaced: false,
      antireqConflicts: NONE,
      blockedByProgram: false,
      missingCourses: pre.missingCourses,
      rawRequirements: pre.rawRequirements,
    };
  }

  // 5. Coreqs — met same-term or earlier. Advisory: an unmet coreq is a
  //    "check", never a hard block (it may be added to this term later).
  let coreqUnmet = false;
  const coreqReasons: string[] = [];
  const coreqAst = resolveCoreqs(course);
  if (coreqAst) {
    const completedWithSame =
      ctx.sameTerm && ctx.sameTerm.size > 0
        ? new Set([...ctx.completed, ...ctx.sameTerm])
        : ctx.completed;
    const co = evaluate(coreqAst, {
      completed: completedWithSame,
      level: ctx.level,
      programs: ctx.programs,
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

/**
 * Does a program/faculty restriction confirm this course is closed to the student?
 * Term-independent (ignores completed/level/antireqs), so an add surface can
 * hard-block a wrong-faculty placement regardless of when it would land. A course
 * the program references is never blocked (via `programReferenced`).
 */
export function isProgramBlocked(
  course: Course,
  opts: {
    programs?: ProgramIdentity[];
    programReferenced?: ReadonlySet<string>;
  },
): boolean {
  const suppressProgramBlock =
    opts.programReferenced?.has(course.code.toLowerCase()) ?? false;
  // `assumeCoursesUncertain`: with no completed set, a not-yet-taken course in
  // the prereqs would otherwise look failed and let an OR'd restriction ("X
  // students only OR CS 135") report blocked. Treating courses as completable
  // keeps this to the UNCONDITIONAL program walls it's meant to detect.
  const pre = evaluate(resolvePrereqs(course), {
    completed: EMPTY_SET,
    programs: opts.programs,
    suppressProgramBlock,
    assumeCoursesUncertain: true,
  });
  return !pre.satisfied && pre.blockedByProgram;
}

/**
 * Build the reverse-antireq index for {@link CourseEligibilityContext}: each code
 * → the placed courses that name it as an antireq. Pass the placed courses'
 * catalog entries (one missing from the catalog can't contribute, so it's skipped).
 */
export function placedAntireqNamers(
  placedCourses: Iterable<Course>,
): Map<string, readonly string[]> {
  const map = new Map<string, string[]>();
  for (const data of placedCourses) {
    const namer = data.code.toLowerCase();
    for (const named of resolveAntireqCodes(data)) {
      if (named === namer) continue;
      const list = map.get(named);
      if (list) list.push(namer);
      else map.set(named, [namer]);
    }
  }
  return map;
}
