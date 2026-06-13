// Guards the per-course unit weights enriched into the committed catalog
// (`courses.<term>.json`). The audit measures unit-based requirements against
// these weights, so they must (a) be sane and (b) cover essentially every
// course that appears in a real program requirement — otherwise the audit would
// silently fall back to counting and under-report units.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROGRAMS, type RuleNode } from "../../programs";
import { PINNED_TERM } from "../../terms";
import { validateCoursesFile } from "../validation";

const courses = validateCoursesFile(
  JSON.parse(
    readFileSync(
      path.resolve(process.cwd(), "data", `courses.${PINNED_TERM}.json`),
      "utf-8",
    ),
  ),
).courses;

const unitOf = new Map(
  courses
    .filter((c) => c.units != null)
    .map((c) => [c.code, c.units as number]),
);

/** Every course code referenced anywhere in a program's requirements. */
function requirementCodes(): Set<string> {
  const out = new Set<string>();
  const walk = (n: RuleNode | undefined) => {
    if (!n) return;
    if (n.kind === "courses" || n.kind === "excluded")
      for (const c of n.courses) out.add(c.toLowerCase());
    if (n.kind === "all" || n.kind === "pick")
      for (const c of n.children) walk(c);
  };
  for (const p of Object.values(PROGRAMS)) {
    if (p.kind === "engineering")
      for (const t of Object.values(p.terms)) walk(t);
    else walk(p.rules);
    for (const e of p.electives ?? [])
      for (const c of e.approvedCourses ?? []) out.add(c.toLowerCase());
    for (const s of p.specializations ?? []) if (s.rules) walk(s.rules);
  }
  return out;
}

describe("per-course unit weights in the catalog", () => {
  it("enriches a substantial number of courses", () => {
    expect(unitOf.size).toBeGreaterThan(3000);
  });

  it("carries only sane unit weights (0–3)", () => {
    for (const [code, u] of unitOf) {
      expect(u, code).toBeGreaterThanOrEqual(0);
      expect(u, code).toBeLessThanOrEqual(3);
    }
  });

  it("covers essentially every requirement-referenced course", () => {
    const codes = requirementCodes();
    const missing = [...codes].filter((c) => !unitOf.has(c));
    // A handful of stragglers (recently renamed/retired courses absent from the
    // active catalog) are tolerable; the audit counts them rather than
    // misreporting units. A real regression would drop many at once, so cap the
    // absolute count (the prior `> 5 ? 0 : len` form was a tautology that bounded
    // nothing).
    expect(
      missing.length,
      `requirement codes lacking a unit weight: ${missing.join(", ")}`,
    ).toBeLessThanOrEqual(5);
  });
});
