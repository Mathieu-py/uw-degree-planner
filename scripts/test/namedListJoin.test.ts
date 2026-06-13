import { describe, expect, it } from "vitest";
import type { RuleNode } from "../../lib/programs";
import { walkRule } from "../../lib/programs";
import { buildNamedListIndex, normalizeListName } from "../scrape/electives";
import { parseProgramRequirements } from "../scrape/programs-parser";

// A courseListsNew section: <h2> heading + anchor course links.
const section = (heading: string, codes: string[]) => `
  <section>
    <header><h2 data-testid="grouping-label"><span>${heading}</span></h2></header>
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

  it("returns an empty map for missing input", () => {
    expect(buildNamedListIndex(undefined).size).toBe(0);
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
});
