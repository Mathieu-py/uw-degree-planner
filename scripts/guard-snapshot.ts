/**
 * Data-quality gate for the scheduled refresh workflows. Run after a fetch/
 * scrape and BEFORE opening the snapshot PR: re-validates every changed data
 * file, confirms only allowlisted files changed, and fails on an anomalous
 * course/seating drop so an upstream glitch can't land a gutted snapshot on
 * main. The pure assessors are exported for unit tests; `main` does the git/fs.
 *
 * Thresholds are env-configurable (defaults below): override for a genuinely
 * large legitimate change without editing code, since this runs unattended.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  type CoursesFile,
  validateCoursesFile,
  validateDescriptionsFile,
} from "../lib/courses/validation";
import { validatePrograms } from "../lib/programs";

export interface Thresholds {
  /** Fail if courseCount falls by more than this fraction vs the committed snapshot. */
  maxCourseDropPct: number;
  /** Fail if the count of courses with seating falls by more than this fraction. */
  maxSectionDropPct: number;
}

// Courses/requisites shift by a handful per term; seating is noisier week to
// week but never halves.
export const DEFAULT_THRESHOLDS: Thresholds = {
  maxCourseDropPct: 0.1,
  maxSectionDropPct: 0.25,
};

// The only files a refresh may touch: per-term courses/descriptions, or programs.
const ALLOWED_FILE = /^data\/(?:courses|descriptions)\.\d+\.json$/;
const PROGRAMS_FILE = "data/programs.json";

/** Paths outside the refresh allowlist — an empty result means all changes are expected. */
export function assessChangedFiles(changed: string[]): string[] {
  return changed
    .filter((p) => !ALLOWED_FILE.test(p) && p !== PROGRAMS_FILE)
    .map((p) => `unexpected changed file: ${p}`);
}

const populatedSections = (f: CoursesFile): number =>
  f.courses.filter((c) => c.sections.length > 0).length;

/**
 * Anomaly checks for a courses snapshot vs its committed predecessor (null for a
 * brand-new term). Returns human-readable violations, empty when healthy.
 */
export function assessCourseSnapshot(
  prev: CoursesFile | null,
  next: CoursesFile,
  t: Thresholds,
): string[] {
  const v: string[] = [];
  if (next.courses.length === 0) {
    v.push("courses snapshot is empty — refusing (mass deletion?)");
    return v;
  }
  if (!prev) return v; // new term: nothing to compare against

  const courseDrop =
    (prev.courses.length - next.courses.length) / prev.courses.length;
  if (courseDrop > t.maxCourseDropPct) {
    v.push(
      `course count dropped ${(courseDrop * 100).toFixed(1)}% (${prev.courses.length} → ${next.courses.length}), over the ${(t.maxCourseDropPct * 100).toFixed(0)}% limit`,
    );
  }

  const prevSec = populatedSections(prev);
  if (prevSec > 0) {
    const nextSec = populatedSections(next);
    const secDrop = (prevSec - nextSec) / prevSec;
    if (secDrop > t.maxSectionDropPct) {
      v.push(
        `courses with seating dropped ${(secDrop * 100).toFixed(1)}% (${prevSec} → ${nextSec}), over the ${(t.maxSectionDropPct * 100).toFixed(0)}% limit`,
      );
    }
  }
  return v;
}

// ---------------------------------------------------------------------------
// IO layer
// ---------------------------------------------------------------------------

const git = (...args: string[]): string =>
  execFileSync("git", args, { encoding: "utf-8" });

/** Working-tree paths that differ from HEAD (tracked changes + untracked), forward-slashed. */
function changedPaths(): string[] {
  return git("status", "--porcelain", "--untracked-files=all")
    .split("\n")
    .map((line) => line.slice(3).trim()) // strip the "XY " status prefix
    .filter(Boolean);
}

/** Committed version of `p` at HEAD, or null if it didn't exist (new term file). */
function committed(p: string): unknown | null {
  try {
    return JSON.parse(git("show", `HEAD:${p}`));
  } catch {
    return null;
  }
}

function readJson(p: string): unknown {
  return JSON.parse(readFileSync(path.resolve(p), "utf-8"));
}

function resolveThresholds(): Thresholds {
  const num = (key: string, fallback: number) => {
    const raw = process.env[key];
    const n = raw == null ? Number.NaN : Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    maxCourseDropPct: num(
      "GUARD_MAX_COURSE_DROP_PCT",
      DEFAULT_THRESHOLDS.maxCourseDropPct,
    ),
    maxSectionDropPct: num(
      "GUARD_MAX_SECTION_DROP_PCT",
      DEFAULT_THRESHOLDS.maxSectionDropPct,
    ),
  };
}

function main() {
  const thresholds = resolveThresholds();
  const changed = changedPaths();
  const violations: string[] = [...assessChangedFiles(changed)];

  if (changed.length === 0) {
    console.log("guard-snapshot: no data changes — nothing to check.");
    return;
  }

  for (const p of changed) {
    try {
      if (p === PROGRAMS_FILE) {
        validatePrograms(readJson(p));
      } else if (/^data\/descriptions\.\d+\.json$/.test(p)) {
        validateDescriptionsFile(readJson(p));
      } else if (/^data\/courses\.\d+\.json$/.test(p)) {
        const next = validateCoursesFile(readJson(p));
        const prevRaw = committed(p);
        const prev = prevRaw ? validateCoursesFile(prevRaw) : null;
        violations.push(...assessCourseSnapshot(prev, next, thresholds));
      }
    } catch (err) {
      violations.push(
        `schema/parse error in ${p}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  if (violations.length > 0) {
    console.error("guard-snapshot: refusing to open a refresh PR:");
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }
  console.log(`guard-snapshot: OK — ${changed.length} data file(s) changed.`);
}

// Run only as a script, not when imported by tests.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]).endsWith("guard-snapshot.ts")
) {
  main();
}
