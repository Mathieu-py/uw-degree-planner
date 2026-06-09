import { describe, expect, it } from "vitest";
import { type PrereqNode, parsePrereqs } from "../parse";
import { evaluate } from "../satisfied";

/** Flatten every `course` code reachable through and/or nodes. */
function courses(node: PrereqNode | null): string[] {
  if (!node) return [];
  if (node.kind === "course") return [node.code];
  if (node.kind === "and" || node.kind === "or") {
    return node.children.flatMap(courses);
  }
  return [];
}

/**
 * Stress tests anchored to verbatim UW Undergraduate Calendar prose.
 * Source: https://ucalendar.uwaterloo.ca/2223/COURSE/course-CS.html
 *
 * These complement parse.test.ts (which already covers the grade-AFTER-code
 * form, e.g. "CS114 with a minimum grade of 60%"). The gap covered here is the
 * grade-BEFORE-code form, where the percentage precedes the course it gates —
 * the tokenizer must still recover the course code instead of swallowing it
 * into an unparseable RAW blob.
 */
describe("prereq parser — real UW prose (grade qualifiers before the code)", () => {
  // Verbatim from the data snapshot (data/courses.1261.json), CS 136 prereqs.
  // The grade thresholds aren't verifiable (the app tracks no grades), so —
  // matching the grade-AFTER-code convention — they're dropped and the
  // requirement reduces to "one of {CS115, CS116, CS135, CS145}".
  const CS136 =
    "One of CS145, at least 90% in CS115, at least 70% in CS116, at least 60% in CS135.";

  it("recovers all four course codes from CS 136's grade-gated 'one of'", () => {
    expect(courses(parsePrereqs(CS136)).sort()).toEqual([
      "cs115",
      "cs116",
      "cs135",
      "cs145",
    ]);
  });

  it("flags CS 136 as missing when none of its alternatives are completed", () => {
    // The harmful failure mode of swallowing the codes: a student who has done
    // NONE of CS115/116/135/145 would otherwise read as "uncertain" (a raw
    // blob) and never be flagged. It must be a definite, attributable miss.
    const r = evaluate(parsePrereqs(CS136), { completed: new Set() });
    expect(r.satisfied).toBe(false);
    expect(r.uncertain).toBe(false);
    expect(r.missingCourses.sort()).toEqual([
      "cs115",
      "cs116",
      "cs135",
      "cs145",
    ]);
  });

  it("treats any one completed alternative as satisfying CS 136's prereq", () => {
    for (const have of ["cs115", "cs116", "cs135", "cs145"]) {
      const r = evaluate(parsePrereqs(CS136), { completed: new Set([have]) });
      expect(r.satisfied, `completed ${have}`).toBe(true);
    }
  });

  it("recovers the single course from a bare grade-gated prereq (FINE 294)", () => {
    // FINE 294 prereq (snapshot): "At least 75% in FINE293" — no OR, just one
    // grade-gated course. The code must survive as a definite requirement.
    const node = parsePrereqs("At least 75% in FINE293");
    expect(node).toEqual({ kind: "course", code: "fine293" });
    expect(evaluate(node, { completed: new Set() }).missingCourses).toEqual([
      "fine293",
    ]);
  });

  it("recovers grade-gated codes nested in parens alongside a program clause (CS 246)", () => {
    // CS 246 prereq (snapshot): "(CS146 and CS136L) or (a grade of 60% or
    // higher in CS138) or (CS136L and a grade of 60% or higher in CS136);
    // Honours Mathematics students only." Every course code must be recovered
    // and the trailing restriction kept as a program node.
    const node = parsePrereqs(
      "(CS146 and CS136L) or (a grade of 60% or higher in CS138) or (CS136L and a grade of 60% or higher in CS136); Honours Mathematics students only.",
    );
    expect(courses(node).sort()).toEqual([
      "cs136",
      "cs136l",
      "cs136l",
      "cs138",
      "cs146",
    ]);
    const flat = JSON.stringify(node);
    expect(flat).toContain("Honours Mathematics students only");
  });
});

describe("prereq parser — other real UW shapes", () => {
  it("AMATH 242: four ';'-separated requirements all survive", () => {
    // Verbatim AMATH 242 prereq from the data snapshot.
    const node = parsePrereqs(
      "One of CS116, CS136, CS138, CS146; One of (CS114 with a minimum grade of 60%), CS115, CS135, CS145; MATH235 or MATH245; MATH237 or MATH247",
    );
    expect(node?.kind).toBe("and");
    expect(courses(node).sort()).toEqual([
      "cs114",
      "cs115",
      "cs116",
      "cs135",
      "cs136",
      "cs138",
      "cs145",
      "cs146",
      "math235",
      "math237",
      "math245",
      "math247",
    ]);
  });

  it("CS 145: 'Department Consent Required' is uncertain, never a hard fail", () => {
    // Pure prose with no course/level structure → raw → "check", so the UI asks
    // the student to verify rather than wrongly blocking.
    const node = parsePrereqs("Department Consent Required");
    expect(node).toEqual({ kind: "raw", text: "Department Consent Required" });
    const r = evaluate(node, { completed: new Set() });
    expect(r.satisfied).toBe(true);
    expect(r.uncertain).toBe(true);
    expect(r.blockedByProgram).toBe(false);
  });

  it("slash-separated equivalents (MTE 121/GENE 121) parse as an OR of both", () => {
    const node = parsePrereqs("MTE121/GENE121");
    expect(courses(node).sort()).toEqual(["gene121", "mte121"]);
  });
});
