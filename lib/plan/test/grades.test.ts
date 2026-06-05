import { describe, expect, it } from "vitest";
import { numericPercent, parseGrade } from "../grades";

describe("parseGrade", () => {
  it("reads a numeric percentage", () => {
    expect(parseGrade("87")).toEqual({ kind: "numeric", percent: 87 });
    expect(parseGrade("82.5")).toEqual({ kind: "numeric", percent: 82.5 });
  });

  it("treats empty / missing as in-progress", () => {
    expect(parseGrade("")).toEqual({ kind: "inProgress" });
    expect(parseGrade(undefined)).toEqual({ kind: "inProgress" });
    expect(parseGrade(null)).toEqual({ kind: "inProgress" });
    expect(parseGrade("IP")).toEqual({ kind: "inProgress" });
  });

  it("maps credit, transfer, and pass tokens (case-insensitive)", () => {
    expect(parseGrade("CR")).toEqual({ kind: "credit" });
    expect(parseGrade("p")).toEqual({ kind: "credit" });
    expect(parseGrade("TR")).toEqual({ kind: "transfer" });
  });

  it("keeps other non-graded outcomes verbatim", () => {
    expect(parseGrade("WD")).toEqual({ kind: "other", raw: "WD" });
    expect(parseGrade("audit?")).toEqual({ kind: "other", raw: "audit?" });
  });
});

describe("numericPercent", () => {
  it("returns the percent only for numeric grades", () => {
    expect(numericPercent("91")).toBe(91);
    expect(numericPercent("CR")).toBeNull();
    expect(numericPercent("")).toBeNull();
  });
});
