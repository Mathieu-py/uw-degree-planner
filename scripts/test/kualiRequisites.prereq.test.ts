import { describe, expect, it } from "vitest";
import { parseKualiRequisite } from "../scrape/kualiRequisites";

// Builders mirroring real Kuali prereq/coreq markup.
const cLink = (code: string) =>
  `<li><span><a href="#/courses/view/id-${code}" target="_blank">${code}</a> <!-- -->-<!-- --> Title <span>(0.50)</span></span></li>`;
const pLink = (name: string) =>
  `<a href="#/programs/view/id" target="_blank">${name}</a>`;
const leaf = (id: string, result: string) =>
  `<li data-test="ruleView-${id}"><div data-test="ruleView-${id}-result">${result}</div></li>`;
const courseLeaf = (id: string, prose: string, ...codes: string[]) =>
  leaf(
    id,
    `${prose}: <div><ul style="margin:5px">${codes.map(cLink).join("")}</ul></div>`,
  );
const root = (inner: string) =>
  `<div><div><div><ul>${inner}</ul></div></div></div>`;
const group = (span: string, ...lis: string[]) =>
  `<li><span>${span}</span><ul>${lis.join("")}</ul></li>`;

describe("parseKualiRequisite — leaves", () => {
  it("'Must have completed the following' with one course → course node", () => {
    const html = root(
      courseLeaf("A", "Must have completed the following", "CS145"),
    );
    expect(parseKualiRequisite(html)).toEqual({
      kind: "course",
      code: "cs145",
    });
  });

  it("'at least 1 of' with two courses → or", () => {
    const html = root(
      courseLeaf(
        "A",
        "Must have completed at least 1 of the following",
        "CS136",
        "CS138",
      ),
    );
    expect(parseKualiRequisite(html)).toEqual({
      kind: "or",
      children: [
        { kind: "course", code: "cs136" },
        { kind: "course", code: "cs138" },
      ],
    });
  });

  it("'at least 2 of' with three courses → countOf n=2", () => {
    const html = root(
      courseLeaf(
        "A",
        "Must have completed at least 2 of the following",
        "MATH135",
        "MATH136",
        "MATH137",
      ),
    );
    expect(parseKualiRequisite(html)).toEqual({
      kind: "countOf",
      n: 2,
      children: [
        { kind: "course", code: "math135" },
        { kind: "course", code: "math136" },
        { kind: "course", code: "math137" },
      ],
    });
  });

  it("'at least N of' collapses to 'and' when N equals the option count", () => {
    const html = root(
      courseLeaf(
        "A",
        "Must have completed at least 2 of the following",
        "MATH135",
        "MATH136",
      ),
    );
    expect(parseKualiRequisite(html)).toEqual({
      kind: "and",
      children: [
        { kind: "course", code: "math135" },
        { kind: "course", code: "math136" },
      ],
    });
  });

  it("drops grade thresholds — 'Earned a minimum grade of 90% in each of' → required courses", () => {
    const html = root(
      courseLeaf(
        "A",
        "Earned a minimum grade of 90% in each of the following",
        "CS115",
      ),
    );
    expect(parseKualiRequisite(html)).toEqual({
      kind: "course",
      code: "cs115",
    });
  });

  it("level gate → level node", () => {
    const html = root(leaf("A", "Students must be in level 2A or higher"));
    expect(parseKualiRequisite(html)).toEqual({
      kind: "level",
      minLevel: "2A",
    });
  });

  it("'Enrolled in <programs>' → allow-list program clause with cleaned names", () => {
    const html = root(
      leaf(
        "A",
        `Enrolled in <span>${pLink("H-Computer Engineering")}, ${pLink("H-Electrical Engineering")}</span>`,
      ),
    );
    expect(parseKualiRequisite(html)).toEqual({
      kind: "program",
      clause: "Computer Engineering or Electrical Engineering students only",
    });
  });

  it("'Not open to <programs>' → negated program clause, parens/prefix stripped", () => {
    const html = root(
      leaf(
        "A",
        `Not open to students enrolled in <span>${pLink("H-Computer Science (BCS)")}</span>`,
      ),
    );
    expect(parseKualiRequisite(html)).toEqual({
      kind: "program",
      clause: "Not open to Computer Science",
    });
  });

  it("milestones / unrecognized prose → raw (→ 'check')", () => {
    const html = root(leaf("A", "Obtained all of the following milestones"));
    const node = parseKualiRequisite(html);
    expect(node?.kind).toBe("raw");
  });

  it("returns null for empty input", () => {
    expect(parseKualiRequisite(null)).toBeNull();
    expect(parseKualiRequisite("")).toBeNull();
  });
});

describe("parseKualiRequisite — groups + nesting", () => {
  it("'Complete all of the following' → and over its children", () => {
    const html = root(
      group(
        "Complete all of the following",
        courseLeaf("A", "Must have completed the following", "CS245"),
        leaf("B", "Students must be in level 2A or higher"),
      ),
    );
    expect(parseKualiRequisite(html)).toEqual({
      kind: "and",
      children: [
        { kind: "course", code: "cs245" },
        { kind: "level", minLevel: "2A" },
      ],
    });
  });

  it("'Complete 1 of the following' → or over its children", () => {
    const html = root(
      group(
        "Complete 1 of the following",
        courseLeaf("A", "Must have completed the following", "CS136"),
        courseLeaf("B", "Must have completed the following", "CS145"),
      ),
    );
    expect(parseKualiRequisite(html)).toEqual({
      kind: "or",
      children: [
        { kind: "course", code: "cs136" },
        { kind: "course", code: "cs145" },
      ],
    });
  });

  it("conjoins multiple top-level leaves into an 'and'", () => {
    const html = root(
      courseLeaf("A", "Must have completed the following", "CS245") +
        leaf("B", "Students must be in level 2A or higher"),
    );
    expect(parseKualiRequisite(html)?.kind).toBe("and");
  });
});
