import { describe, expect, it } from "vitest";
import { earnsCredit, parseGrade } from "../grades";

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

describe("earnsCredit", () => {
  it("credits a passing numeric grade (>= 50)", () => {
    expect(earnsCredit("50")).toBe(true);
    expect(earnsCredit("87")).toBe(true);
  });
  it("denies credit for a failing numeric grade (< 50)", () => {
    expect(earnsCredit("49")).toBe(false);
    expect(earnsCredit("12")).toBe(false);
  });
  it("credits CR / P / TR", () => {
    expect(earnsCredit("CR")).toBe(true);
    expect(earnsCredit("P")).toBe(true);
    expect(earnsCredit("TR")).toBe(true);
  });
  it("credits not-yet-graded courses (IP / blank — planned)", () => {
    expect(earnsCredit("")).toBe(true);
    expect(earnsCredit(undefined)).toBe(true);
    expect(earnsCredit("IP")).toBe(true);
  });
  it("denies credit for withdrawn / failed / other outcomes", () => {
    expect(earnsCredit("WD")).toBe(false);
    expect(earnsCredit("W")).toBe(false);
    expect(earnsCredit("NCR")).toBe(false);
    expect(earnsCredit("F")).toBe(false);
  });
});
