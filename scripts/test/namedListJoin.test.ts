import { describe, expect, it } from "vitest";
import type { RuleNode } from "../../lib/programs";
import { walkRule } from "../../lib/programs";
import {
  buildNamedListIndex,
  normalizeListName,
} from "../scrape/program/electives";
import { parseProgramRequirements } from "../scrape/programs-parser";

// A courseListsNew section: <h2> heading + anchor course links.
const section = (heading: string, codes: string[]) => `
  <section>
    <header><h2 data-testid="grouping-label"><span>${heading}</span></h2></header>
    <div>${codes.map((c) => `<a href="#/courses/x">${c}</a>`).join(" ")}</div>
  </section>`;

// A nested sub-list with a BARE <h2> (no grouping-label) — how Kuali emits
// "List 1"/"List 2" under an outer "Technical Electives List". R1/R2.
const bareSection = (heading: string, codes: string[]) => `
  <section>
    <h2><span>${heading}</span></h2>
    <div>${codes.map((c) => `<a href="#/courses/x">${c}</a>`).join(" ")}</div>
  </section>`;

// A requirements leaf rule (no course links of its own).
const rule = (text: string) => `
  <section>
    <header><h2 data-testid="grouping-label"><span>Required Courses</span></h2></header>
    <div><div><ul>
      <li data-test="ruleView-A"><div data-test="ruleView-A-result">${text}</div></li>
    </ul></div></div>
  </section>`;

function pickNodes(root: RuleNode): Array<RuleNode & { kind: "pick" }> {
  const out: Array<RuleNode & { kind: "pick" }> = [];
  walkRule(root, (n) => {
    if (n.kind === "pick") out.push(n);
  });
  return out;
}

function coursesIn(node: RuleNode): string[] {
  const out: string[] = [];
  walkRule(node, (n) => {
    if (n.kind === "courses") out.push(...n.courses);
  });
  return out;
}

describe("normalizeListName", () => {
  it("collides a heading and its rule reference", () => {
    expect(normalizeListName("Technical Electives List")).toBe(
      "technical electives",
    );
    expect(normalizeListName("the Technical Electives (TEs) lists")).toBe(
      "technical electives",
    );
    expect(normalizeListName("List A")).toBe("a");
    expect(normalizeListName("List 1")).toBe("1");
  });
});

describe("buildNamedListIndex", () => {
  it("indexes sections with a heading and courses, skips empty ones", () => {
    const idx = buildNamedListIndex(
      section("Technical Electives List", ["SYDE 522", "SYDE 543"]) +
        section("Empty List", []),
    );
    expect(idx.get("technical electives")).toEqual(["syde522", "syde543"]);
    expect(idx.has("empty")).toBe(false);
  });

  it("merges sections whose headings normalize to the same key", () => {
    // Both headings → "technical electives"; the second must not drop the first.
    const idx = buildNamedListIndex(
      section("Technical Electives List", ["SYDE 522"]) +
        section("the Technical Electives (TEs) lists", ["SYDE 543"]),
    );
    expect(idx.get("technical electives")).toEqual(["syde522", "syde543"]);
  });

  it("returns an empty map for missing input", () => {
    expect(buildNamedListIndex(undefined).size).toBe(0);
  });

  it("indexes a bare-<h2> sub-list with no grouping-label testid", () => {
    // "List 1"/"List 2" nest under "Technical Electives List" with a bare <h2>;
    // without the fallback the index skipped them and "from List 1" never resolved.
    const idx = buildNamedListIndex(
      bareSection("List 1", ["ECE 320", "ECE 358"]),
    );
    expect(idx.get("1")).toEqual(["ece320", "ece358"]);
  });
});

describe("named-list join (#117 bucket D)", () => {
  it("joins 'four courses from the Technical Electives lists' to the list", () => {
    const r = parseProgramRequirements({
      requirements: rule("four courses from the Technical Electives lists"),
      courseListsNew: section("Technical Electives List", [
        "SYDE 522",
        "SYDE 543",
        "SYDE 552",
      ]),
    });
    if (r.kind !== "flexible") throw new Error("expected flexible");
    const picks = pickNodes(r.rules);
    expect(picks.length).toBe(1);
    expect(picks[0].selectMin).toBe(4);
    expect(coursesIn(r.rules).sort()).toEqual([
      "syde522",
      "syde543",
      "syde552",
    ]);
    expect(r.unverified).toEqual([]);
  });

  it("expands a 'List A, B, C, or D' enumeration to the union of those lists", () => {
    const r = parseProgramRequirements({
      requirements: rule("Complete 2 courses from List A, B, C, or D"),
      courseListsNew:
        section("List A", ["ECE 600"]) +
        section("List B", ["ECE 601"]) +
        section("List C", ["ECE 602"]) +
        section("List D", ["ECE 603"]),
    });
    if (r.kind !== "flexible") throw new Error("expected flexible");
    expect(coursesIn(r.rules).sort()).toEqual([
      "ece600",
      "ece601",
      "ece602",
      "ece603",
    ]);
    expect(pickNodes(r.rules)[0].selectMin).toBe(2);
    expect(r.unverified).toEqual([]);
  });

  it("leaves a reference to an unknown list unverified", () => {
    // A list named only in additionalConstraints prose (no courseListsNew
    // section) is discretionary — it stays unverified, by design.
    const r = parseProgramRequirements({
      requirements: rule(
        "Complete 1 additional course from the options in List 1",
      ),
      courseListsNew: section("Technical Electives List", ["SYDE 522"]),
    });
    if (r.kind !== "flexible" && r.kind !== "empty")
      throw new Error("unexpected kind");
    expect(r.unverified).toEqual([
      "Complete 1 additional course from the options in List 1",
    ]);
  });

  it("does not over-union a single-letter 'List A' reference into a fuzzy heading", () => {
    // "List A" → key "a"; the contains-fallback must NOT match "technical
    // electives" (which contains the letter 'a'). With no real List A section the
    // rule stays unverified rather than grabbing the wrong list.
    const r = parseProgramRequirements({
      requirements: rule("Complete 1 course from List A"),
      courseListsNew: section("Technical Electives List", ["SYDE 522"]),
    });
    expect(r.unverified).toContain("Complete 1 course from List A");
    if (r.kind === "flexible") expect(coursesIn(r.rules)).toEqual([]);
  });

  it("still resolves a multi-word reference via the contains-match fallback", () => {
    // "Technical Electives for Option A" ⊇ heading "Technical Electives" — the
    // length-guarded fuzzy match still joins (only single letters are exact-only).
    const r = parseProgramRequirements({
      requirements: rule(
        "Complete four courses from the Technical Electives for Option A lists",
      ),
      courseListsNew: section("Technical Electives List", [
        "SYDE 522",
        "SYDE 543",
      ]),
    });
    if (r.kind !== "flexible") throw new Error("expected flexible");
    expect(coursesIn(r.rules).sort()).toEqual(["syde522", "syde543"]);
    expect(pickNodes(r.rules)[0].selectMin).toBe(4);
    expect(r.unverified).toEqual([]);
  });

  it("reads 'Complete a course from the <list>' as a required pick of 1", () => {
    // The article "a"/"an" is a count of 1. Without it, no count parsed → an OPEN
    // (optional) pick that silently drops the requirement. Regression for #117.
    const r = parseProgramRequirements({
      requirements: rule(
        "Complete a course from the Technical Electives lists",
      ),
      courseListsNew: section("Technical Electives List", [
        "SYDE 522",
        "SYDE 543",
      ]),
    });
    if (r.kind !== "flexible") throw new Error("expected flexible");
    const picks = pickNodes(r.rules);
    expect(picks).toHaveLength(1);
    expect(picks[0].selectMin).toBe(1);
    expect(r.unverified).toEqual([]);
  });

  it("reads a UNIT-stated named-list rule as a gating pick (units ÷ 0.5)", () => {
    // "2.0 units from the … lists" has no course COUNT but a unit total → a real
    // pick of 4, not an optional pick and not unverified. The honest, trackable
    // reading of a single-list unit requirement. Regression for #117.
    const r = parseProgramRequirements({
      requirements: rule(
        "Complete courses from the Technical Electives lists to total 2.0 units",
      ),
      courseListsNew: section("Technical Electives List", [
        "SYDE 522",
        "SYDE 543",
        "SYDE 552",
        "SYDE 575",
      ]),
    });
    if (r.kind !== "flexible") throw new Error("expected flexible");
    const picks = pickNodes(r.rules);
    expect(picks).toHaveLength(1);
    expect(picks[0].selectMin).toBe(4); // 2.0 units ÷ 0.5
    expect(r.unverified).toEqual([]);
  });

  it("leaves a COMPOUND 'X courses or from the list' rule unverified (list is only part)", () => {
    // A pool half ("GER courses") unioned with the list can't be structured as a
    // list-only pick without being too strict, so it gates as unverified — an
    // honest reading rather than a wrong one. Regression for #117 evaluation.
    const text =
      "Complete 2.0 units of GER courses or from the Technical Electives lists";
    const r = parseProgramRequirements({
      requirements: rule(text),
      courseListsNew: section("Technical Electives List", ["SYDE 522"]),
    });
    expect(r.unverified).toContain(text);
    const picks = r.kind === "flexible" ? pickNodes(r.rules) : [];
    expect(picks).toEqual([]);
  });

  it("leaves a named-list rule with NO count at all unverified (no optional pick)", () => {
    // Neither a course count nor a unit total → an open pick would be optional and
    // silently drop the requirement, so it must gate as unverified. See #117.
    const text =
      "Complete courses from the Technical Electives lists as approved";
    const r = parseProgramRequirements({
      requirements: rule(text),
      courseListsNew: section("Technical Electives List", ["SYDE 522"]),
    });
    expect(r.unverified).toContain(text);
    const picks = r.kind === "flexible" ? pickNodes(r.rules) : [];
    expect(picks).toEqual([]);
  });

  it("does not turn prose that merely MENTIONS a list into a pick", () => {
    // "In List 1, keep a 60% average" references a list but is a constraint, not a
    // selection rule — it must not become a pick over List 1's courses. See #117.
    const r = parseProgramRequirements({
      requirements: rule("In List 1, students must keep a 60% average"),
      courseListsNew: section("List 1", ["CS 245", "CS 246"]),
    });
    const picks = r.kind === "flexible" ? pickNodes(r.rules) : [];
    expect(picks).toEqual([]);
  });

  it("does not over-union every '… electives' list from a bare 'electives' reference", () => {
    // "electives" is neither an exact heading nor MORE specific than one, so it
    // must not sweep in both "Technical Electives" and "Science Electives". The
    // rule stays unverified rather than grabbing an over-broad union. See #117.
    const text = "Complete 1 course from the electives lists";
    const r = parseProgramRequirements({
      requirements: rule(text),
      courseListsNew:
        section("Technical Electives List", ["SYDE 522"]) +
        section("Science Electives List", ["BIOL 130"]),
    });
    expect(r.unverified).toContain(text);
    const picks = r.kind === "flexible" ? pickNodes(r.rules) : [];
    expect(picks).toEqual([]);
  });

  it("reads 'Complete N Technical Electives from List 1' as a pick of N (R1)", () => {
    // The count "2" sits before a domain noun ("Technical Electives"), so the
    // usual leading-count read (which needs "courses"/"of" right after) misses it
    // and the honest guard would drop the count → unverified. R1 recovers it.
    const r = parseProgramRequirements({
      requirements: rule("Complete 2 Technical Electives from List 1"),
      // Bare <h2> sub-list — the index must still key it "1" (regression: only
      // the grouping-label header was read, so "from List 1" never resolved).
      courseListsNew: bareSection("List 1", ["ECE 320", "ECE 327", "ECE 350"]),
    });
    if (r.kind !== "flexible") throw new Error("expected flexible");
    const picks = pickNodes(r.rules);
    expect(picks).toHaveLength(1);
    expect(picks[0].selectMin).toBe(2);
    expect(coursesIn(r.rules).sort()).toEqual(["ece320", "ece327", "ece350"]);
    expect(r.unverified).toEqual([]);
  });

  // A titled requirement SECTION referenced by a sibling rule ("… from the list
  // of Approved Courses below"). Chemistry states 5 approved courses in the
  // "Approved Courses List" section and 1 more from Required Courses; the "+1"
  // must join the same section, not strand in unverified. #117.
  const approvedListSection = (heading: string, codes: string[]) => `
    <section>
      <header><h2 data-testid="grouping-label"><span>${heading}</span></h2></header>
      <div><div><ul>
        <li data-test="ruleView-B"><div data-test="ruleView-B-result">Complete 2.5 units from the following list of courses: ${codes
          .map((c) => `<a href="#/courses/x">${c}</a>`)
          .join(" ")}</div></li>
      </ul></div></div>
    </section>`;

  it("joins '1 additional course from the list of Approved Courses below' to that section", () => {
    const approved = ["CHEM 209", "CHEM 331", "CHEM 400", "CHEM 481"];
    const r = parseProgramRequirements({
      requirements:
        rule(
          "Complete 1 additional course from the list of Approved Courses below",
        ) + approvedListSection("Approved Courses List", approved),
    });
    if (r.kind !== "flexible") throw new Error("expected flexible");
    expect(r.unverified).toEqual([]);
    // The "+1" resolves to a required pick of 1 over the approved section.
    const plusOne = pickNodes(r.rules).find((p) => p.selectMin === 1);
    expect(plusOne).toBeDefined();
    expect(coursesIn(plusOne as RuleNode).sort()).toEqual([
      "chem209",
      "chem331",
      "chem400",
      "chem481",
    ]);
  });

  it("leaves a COMPOUND 'GER courses or from the list of … below' unverified", () => {
    // The list is only PART of the options (unioned with a subject-code pool), so
    // a list-only pick would be too strict — it must gate as unverified. Mirrors
    // h-german / 3g-german, which stay unverified by design.
    const text =
      "Complete 2.0 units of GER courses or from the list of Approved Courses below";
    const r = parseProgramRequirements({
      requirements:
        rule(text) + approvedListSection("Approved Courses List", ["GER 250"]),
    });
    expect(r.unverified).toContain(text);
  });

  it("resolves a repeated 'from List 1 or List 2' reference to the union (R2)", () => {
    // LIST_ENUM_RE mis-splits "List 1 or List 2" at the second "List" (capturing
    // "1 or L"), so only List 1 resolved. The global List-ref scan picks up both.
    const r = parseProgramRequirements({
      requirements: rule("Complete 1 Technical Elective from List 1 or List 2"),
      courseListsNew:
        bareSection("List 1", ["ECE 320"]) + bareSection("List 2", ["ECE 358"]),
    });
    if (r.kind !== "flexible") throw new Error("expected flexible");
    const picks = pickNodes(r.rules);
    expect(picks).toHaveLength(1);
    expect(picks[0].selectMin).toBe(1);
    expect(coursesIn(r.rules).sort()).toEqual(["ece320", "ece358"]);
    expect(r.unverified).toEqual([]);
  });
});
