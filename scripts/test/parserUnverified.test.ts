import { describe, expect, it } from "vitest";
import { parseProgramRequirements } from "../scrape/programs-parser";

// A single requirements leaf rule; `inner` may include Kuali <a> course links.
const rule = (inner: string) => `
  <section>
    <header><h2 data-testid="grouping-label"><span>Required Courses</span></h2></header>
    <div><div><ul>
      <li data-test="ruleView-A"><div data-test="ruleView-A-result">${inner}</div></li>
    </ul></div></div>
  </section>`;
const link = (code: string) => `<a href="#/courses/x">${code}</a>`;

describe("parseProgramRequirements — surfaces owed rules instead of dropping (#4)", () => {
  it("keeps a conditional 'If …' rule that names courses as unverified", () => {
    // Was dropped silently by DEFERRED_PROSE_RE; now surfaced so the student
    // sees the owed (unstructurable) rule.
    const text = `If you entered before Fall 2020, complete ${link("CS 241")} instead of ${link("CS 241E")}`;
    const r = parseProgramRequirements({ requirements: rule(text) });
    expect(
      r.unverified.some((u) => /If you entered before Fall 2020/i.test(u)),
    ).toBe(true);
  });

  it("keeps a scoped 'approved electives from List N' rule as unverified", () => {
    // FREE_ELECTIVE_RE used to drop this, losing the List scope. A scope means a
    // real gating requirement, so it must surface.
    const r = parseProgramRequirements({
      requirements: rule("Complete 4 approved electives from List 2"),
    });
    expect(r.unverified).toContain("Complete 4 approved electives from List 2");
  });

  it("keeps a level-scoped 'approved electives at the 300-level' rule as unverified", () => {
    // The `approved electives` branch of FREE_ELECTIVE_RE matches regardless of
    // level; a level floor is a real gate, so it must surface rather than drop as
    // an open free elective (else the audit reads 100% with the gate unaccounted).
    const r = parseProgramRequirements({
      requirements: rule("Complete 2.0 units of approved electives at the 300-level"),
    });
    expect(r.unverified).toContain(
      "Complete 2.0 units of approved electives at the 300-level",
    );
  });

  it("still drops a genuinely-open free elective (no scope)", () => {
    const r = parseProgramRequirements({
      requirements: rule("Complete 4 approved electives"),
    });
    expect(r.unverified).toEqual([]);
  });

  it("records a dropped free elective in freeElectives so the assembler can re-surface it", () => {
    // Dropping it from the rule tree is only safe when the program has a
    // totalUnits denominator; the assembler re-surfaces these as unverified for
    // programs that lack one. Here it must land in freeElectives, not unverified.
    const r = parseProgramRequirements({
      requirements: rule("Complete 4 approved electives"),
    });
    expect(r.unverified).toEqual([]);
    expect(r.freeElectives).toContain("Complete 4 approved electives");
  });

  it("keeps a range pick carrying a subject-diversity filter as unverified", () => {
    // A plain pick over the range would silently drop the "same subject code"
    // constraint and over-credit; keep it unverified instead.
    const text = `Complete 3 courses from the following, no two from the same subject code: ${link("CS 440")} ${link("CS 450")}`;
    const r = parseProgramRequirements({ requirements: rule(text) });
    expect(r.unverified.some((u) => /same subject code/i.test(u))).toBe(true);
  });

  it("keeps a diversity filter phrased WITHOUT the word 'code' unverified", () => {
    // "in two different subjects" (no literal "code") used to slip past the
    // guard and over-credit; the broadened pattern now keeps it unverified.
    const text = `Complete 2 courses from the following, in two different subjects: ${link("CS 440")} ${link("CS 450")}`;
    const r = parseProgramRequirements({ requirements: rule(text) });
    expect(r.unverified.some((u) => /different subjects/i.test(u))).toBe(true);
  });

  it("surfaces a unit-quota li nested under a metaParent instead of dropping it", () => {
    // A "Complete N units from the following list" child of a "Complete N of the
    // following choices" parent matches neither the metaParent nor node branch of
    // the inner sibling loop; without a fallback it vanished silently.
    const section = `
      <section>
        <header><h2 data-testid="grouping-label"><span>Required Courses</span></h2></header>
        <div><div><ul>
          <li data-test="ruleView-A"><div data-test="ruleView-A-result">Complete 2 courses from the following choices:</div></li>
          <li data-test="ruleView-B"><div data-test="ruleView-B-result">Complete 1.0 units from the following list</div></li>
        </ul></div></div>
      </section>`;
    const r = parseProgramRequirements({ requirements: section });
    expect(r.unverified.some((u) => /from the following list/i.test(u))).toBe(
      true,
    );
  });
});
