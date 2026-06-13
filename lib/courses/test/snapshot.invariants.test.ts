import { describe, expect, it } from "vitest";
import type { PrereqNode } from "@/lib/prereqs/parse";
import coursesData from "../../../data/courses.1261.json";
import { equivalenceForCatalog } from "../equivalence";

/**
 * Data-quality guardrails over the committed catalog snapshot (CodeRabbit PR
 * #114). These run against the real generated data, so a regression in the
 * build pipeline (or a bad hand-edit) is caught here rather than surfacing as a
 * subtle runtime miscount. They also pin the invariants that the runtime
 * validator (lib/courses/validation.ts) relies on.
 */

interface SnapshotCourse {
  id: number;
  code: string;
  units?: number;
  prereqs: string | null;
  sections: {
    id: number;
    enrollment_total: number;
    enrollment_capacity: number;
  }[];
  crossListed?: string[];
  antireqCodes?: string[];
  prereqAst?: PrereqNode | null;
  coreqAst?: PrereqNode | null;
}

const snapshot = coursesData as {
  termId: number;
  fetchedAt: string;
  courseCount: number;
  courses: SnapshotCourse[];
};
const courses = snapshot.courses;
const codes = new Set(courses.map((c) => c.code));

/** Canonical stored code form: lowercase letters, digits, optional letter suffix. */
const CODE_RE = /^[a-z]+\d+[a-z]*$/;

/**
 * Inert UWFlow placeholder/high-school/transfer pseudo-courses (no Kuali units,
 * cross-listings, requisites, or program references) whose codes aren't
 * canonical. build-catalog now filters these, so this allowlist should empty
 * after the next snapshot rebuild — until then we tolerate the existing set
 * while still failing on any NEW non-canonical primary code.
 */
const KNOWN_NONCANONICAL = new Set([
  "arts1x000",
  "bus-----",
  "cheche",
  "gs*",
  "gs-",
  "gs.",
  "gs;",
  "gs~",
  "hsa&g",
  "hsacc",
  "hscalc",
  "hschem",
  "hscs",
  "hsfmath",
  "hsfr",
  "hsger",
  "hsphys",
  "hsport",
  "hsspan",
  "lang1x000",
  "tpm1x000",
  "ts-",
  "whmis1x000",
]);

/** Course codes named by a prereq/coreq AST. */
function astCodes(node: PrereqNode | null | undefined, out: string[]): void {
  if (!node) return;
  switch (node.kind) {
    case "course":
      out.push(node.code);
      break;
    case "and":
    case "or":
    case "countOf":
      for (const c of node.children) astCodes(c, out);
      break;
    case "coreqOf":
      astCodes(node.child, out);
      break;
    // level / program / raw carry no course codes.
  }
}

describe("catalog snapshot — structural invariants", () => {
  it("courseCount equals the courses array length", () => {
    expect(snapshot.courseCount).toBe(courses.length);
  });

  it("termId is a positive integer and fetchedAt is an ISO datetime", () => {
    expect(Number.isInteger(snapshot.termId) && snapshot.termId > 0).toBe(true);
    expect(Number.isNaN(Date.parse(snapshot.fetchedAt))).toBe(false);
  });

  it("every section has an integer id and non-negative enrolment numbers", () => {
    const bad = courses.flatMap((c) =>
      c.sections
        .filter(
          (s) =>
            !Number.isInteger(s.id) ||
            !(s.enrollment_total >= 0) ||
            !(s.enrollment_capacity >= 0),
        )
        .map((s) => `${c.code}#${s.id}`),
    );
    expect(bad).toEqual([]);
  });
});

describe("catalog snapshot — code normalization", () => {
  it("all course codes are in canonical form (modulo known UWFlow junk)", () => {
    const bad = courses
      .map((c) => c.code)
      .filter((c) => !CODE_RE.test(c) && !KNOWN_NONCANONICAL.has(c));
    expect(bad).toEqual([]);
  });

  it("crossListed and antireqCodes entries are in canonical form", () => {
    const bad = courses.flatMap((c) =>
      [...(c.crossListed ?? []), ...(c.antireqCodes ?? [])].filter(
        (m) => !CODE_RE.test(m),
      ),
    );
    expect([...new Set(bad)]).toEqual([]);
  });

  it("all AST course codes are in canonical form", () => {
    const bad: string[] = [];
    for (const c of courses) {
      const out: string[] = [];
      astCodes(c.prereqAst, out);
      astCodes(c.coreqAst, out);
      for (const code of out) if (!CODE_RE.test(code)) bad.push(code);
    }
    expect([...new Set(bad)]).toEqual([]);
  });
});

describe("catalog snapshot — cross-listing integrity", () => {
  it("no course lists its own code as a cross-listed twin", () => {
    expect(
      courses.filter((c) => c.crossListed?.includes(c.code)).map((c) => c.code),
    ).toEqual([]);
  });

  it("every cross-listed member resolves to a catalog course", () => {
    const missing = new Set<string>();
    for (const c of courses)
      for (const m of c.crossListed ?? []) if (!codes.has(m)) missing.add(m);
    expect([...missing]).toEqual([]);
  });

  it("equivalence classes have a single consistent unit weight", () => {
    const equiv = equivalenceForCatalog(courses);
    const unitsByCode = new Map(courses.map((c) => [c.code, c.units]));
    const seen = new Set<string>();
    const mismatches: string[] = [];
    for (const c of courses) {
      const klass = equiv.classOf(c.code);
      if (klass.length < 2 || seen.has(klass[0])) continue;
      seen.add(klass[0]);
      const units = new Set(
        klass.map((m) => unitsByCode.get(m)).filter((u) => u != null),
      );
      if (units.size > 1)
        mismatches.push(`${klass.join("=")} → ${[...units].join("/")}`);
    }
    expect(mismatches).toEqual([]);
  });
});
