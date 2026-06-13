import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseKualiAntireqCodes,
  parseKualiRequisite,
} from "../scrape/kualiRequisites";

/**
 * Golden fixtures: whole-document Kuali requisite HTML (under fixtures/kuali/),
 * parsed end-to-end. The inline-builder tests pin individual shapes; these guard
 * against drift in the realistic nested markup the scraper actually receives.
 */
const fixture = (name: string) =>
  readFileSync(
    path.join(__dirname, "fixtures", "kuali", `${name}.html`),
    "utf-8",
  );

describe("parseKualiRequisite — golden fixtures", () => {
  it("prereq-all → AND of a course and a level gate", () => {
    expect(parseKualiRequisite(fixture("prereq-all"))).toEqual({
      kind: "and",
      children: [
        { kind: "course", code: "cs245" },
        { kind: "level", minLevel: "2A" },
      ],
    });
  });

  it("prereq-or → OR over two courses", () => {
    expect(parseKualiRequisite(fixture("prereq-or"))).toEqual({
      kind: "or",
      children: [
        { kind: "course", code: "cs136" },
        { kind: "course", code: "cs138" },
      ],
    });
  });

  it("prereq-countof → countOf n=2 over three courses", () => {
    expect(parseKualiRequisite(fixture("prereq-countof"))).toEqual({
      kind: "countOf",
      n: 2,
      children: [
        { kind: "course", code: "math135" },
        { kind: "course", code: "math136" },
        { kind: "course", code: "math137" },
      ],
    });
  });

  it("prereq-program → allow-list program clause", () => {
    expect(parseKualiRequisite(fixture("prereq-program"))).toEqual({
      kind: "program",
      clause: "Computer Engineering or Electrical Engineering students only",
    });
  });
});

describe("parseKualiAntireqCodes — golden fixtures", () => {
  it("antireq-list → normalized course codes", () => {
    expect(parseKualiAntireqCodes(fixture("antireq-list"))).toEqual([
      "cs245e",
      "cs246",
    ]);
  });
});
