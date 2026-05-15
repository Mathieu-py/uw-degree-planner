import { describe, expect, it } from "vitest";
import { formatCourseCode, formatPercent, truncate } from "../format";

describe("formatPercent", () => {
  it("renders an em dash for null or undefined", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(undefined)).toBe("—");
  });
  it("rounds to the nearest whole percent", () => {
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(0.5)).toBe("50%");
    expect(formatPercent(0.834)).toBe("83%");
    expect(formatPercent(0.835)).toBe("84%");
    expect(formatPercent(1)).toBe("100%");
  });
});

describe("formatCourseCode", () => {
  it("inserts a space between prefix and number", () => {
    expect(formatCourseCode("math116")).toBe("MATH 116");
    expect(formatCourseCode("CS486")).toBe("CS 486");
  });
  it("preserves trailing letters in the number portion", () => {
    expect(formatCourseCode("msci261b")).toBe("MSCI 261B");
  });
  it("returns the original (uppercased) when it does not match prefix+number", () => {
    expect(formatCourseCode("not-a-code")).toBe("NOT-A-CODE");
    expect(formatCourseCode("")).toBe("");
  });
});

describe("truncate", () => {
  it("returns an empty string for null or undefined", () => {
    expect(truncate(null)).toBe("");
    expect(truncate(undefined)).toBe("");
  });
  it("leaves short strings unchanged", () => {
    expect(truncate("hi", 10)).toBe("hi");
  });
  it("appends an ellipsis when the input is too long", () => {
    const result = truncate("a".repeat(150), 10);
    expect(result).toBe("aaaaaaaaaa…");
    expect(result.endsWith("…")).toBe(true);
  });
  it("trims trailing whitespace before the ellipsis", () => {
    expect(truncate("hello world foo bar", 6)).toBe("hello…");
  });
  it("defaults to max=140", () => {
    expect(truncate("x".repeat(140))).toBe("x".repeat(140));
    expect(truncate("x".repeat(141)).length).toBe(141);
  });
});
