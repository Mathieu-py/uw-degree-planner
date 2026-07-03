import { describe, expect, it } from "vitest";
import type { PrereqNode } from "../../lib/prereqs/parse";
import {
  isCoreqReference,
  parseKualiRequisite,
  spliceCoreqReferences,
} from "../scrape/sources/kualiRequisites";

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

  it("coreq 'Completed or concurrently enrolled in at least 1 of' → or (not and)", () => {
    // ACTSC 231's real coreq markup. COREQ_ALL_RE ("Completed or concurrently
    // enrolled in") is a prefix of this text, so the "at least n of" form must
    // win — otherwise the OR collapses into a (wrong) AND.
    const html = root(
      courseLeaf(
        "A",
        "Completed or concurrently enrolled in at least 1 of the following",
        "STAT230",
        "STAT240",
      ),
    );
    expect(parseKualiRequisite(html)).toEqual({
      kind: "or",
      children: [
        { kind: "course", code: "stat230" },
        { kind: "course", code: "stat240" },
      ],
    });
  });

  it("coreq 'Completed or concurrently enrolled in' (all required) → and", () => {
    const html = root(
      courseLeaf(
        "A",
        "Completed or concurrently enrolled in",
        "MATH237",
        "MATH239",
      ),
    );
    expect(parseKualiRequisite(html)).toEqual({
      kind: "and",
      children: [
        { kind: "course", code: "math237" },
        { kind: "course", code: "math239" },
      ],
    });
  });

  it("graded choice 'Earned a minimum grade of 85% in at least 1 of' → or (not and)", () => {
    // CS240E's real prereq markup. GRADE_IN_EACH_RE's `\b` branch also matches
    // this text, so the "at least n of" form must be detected first — otherwise
    // a graded OR collapses into a (wrong) AND.
    const html = root(
      courseLeaf(
        "A",
        "Earned a minimum grade of 85% in at least 1 of the following",
        "CS136",
        "CS138",
        "CS146",
      ),
    );
    expect(parseKualiRequisite(html)).toEqual({
      kind: "or",
      children: [
        { kind: "course", code: "cs136" },
        { kind: "course", code: "cs138" },
        { kind: "course", code: "cs146" },
      ],
    });
  });

  it("graded choice 'at least 2 of' → countOf n=2", () => {
    const html = root(
      courseLeaf(
        "A",
        "Earned a minimum grade of 70% in at least 2 of the following",
        "MATH106",
        "MATH114",
        "MATH115",
      ),
    );
    expect(parseKualiRequisite(html)).toEqual({
      kind: "countOf",
      n: 2,
      children: [
        { kind: "course", code: "math106" },
        { kind: "course", code: "math114" },
        { kind: "course", code: "math115" },
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

describe("spliceCoreqReferences (ACTSC 231 'or a corequisite of …')", () => {
  const c = (code: string): PrereqNode => ({ kind: "course", code });

  it("recognizes bare coreq-pointer text, not real requirements", () => {
    expect(isCoreqReference("Corequisite (see below)")).toBe(true);
    expect(isCoreqReference("Corequisite")).toBe(true);
    expect(isCoreqReference("Must have completed the following")).toBe(false);
    expect(isCoreqReference("STAT 230")).toBe(false);
  });

  it("replaces the pointer leaf with a coreqOf and reports it consumed", () => {
    const prereq: PrereqNode = {
      kind: "or",
      children: [
        c("stat220"),
        { kind: "raw", text: "Corequisite (see below)" },
      ],
    };
    const coreq: PrereqNode = {
      kind: "or",
      children: [c("stat230"), c("stat240")],
    };
    expect(spliceCoreqReferences(prereq, coreq)).toEqual({
      node: {
        kind: "or",
        children: [c("stat220"), { kind: "coreqOf", child: coreq }],
      },
      consumed: true,
    });
  });

  it("is a no-op when there is no coreq tree to splice (pointer stays raw)", () => {
    const prereq: PrereqNode = {
      kind: "or",
      children: [
        c("stat220"),
        { kind: "raw", text: "Corequisite (see below)" },
      ],
    };
    const result = spliceCoreqReferences(prereq, null);
    expect(result.node).toBe(prereq);
    expect(result.consumed).toBe(false);
  });

  it("leaves a prereq with no coreq pointer untouched and unconsumed", () => {
    const prereq: PrereqNode = { kind: "and", children: [c("math137")] };
    const result = spliceCoreqReferences(prereq, c("stat230"));
    expect(result.node).toEqual(prereq);
    // Unconsumed → the standalone coreq AST is a REAL corequisite and must be
    // kept on the record (buildRecord drops it only when consumed).
    expect(result.consumed).toBe(false);
  });
});
