import { describe, expect, it } from "vitest";
import { extractCourseCodes, normalizeCourseCode } from "./extract";

describe("normalizeCourseCode", () => {
  it.each([
    ["MATH 116", "math116"],
    ["MATH116", "math116"],
    ["math 116", "math116"],
    ["BUS393W", "bus393w"],
    ["AFM 101", "afm101"],
  ])("normalizes %s → %s", (input, expected) => {
    expect(normalizeCourseCode(input)).toBe(expected);
  });
});

describe("extractCourseCodes", () => {
  it("returns empty for nullish input", () => {
    expect(extractCourseCodes(null)).toEqual([]);
    expect(extractCourseCodes(undefined)).toEqual([]);
    expect(extractCourseCodes("")).toEqual([]);
  });

  it("pulls a single code", () => {
    expect(extractCourseCodes("MATH116")).toEqual(["math116"]);
  });

  it("handles space between prefix and number", () => {
    expect(extractCourseCodes("MATH 116 or AFM 101")).toEqual([
      "math116",
      "afm101",
    ]);
  });

  it("deduplicates", () => {
    expect(extractCourseCodes("MATH116; MATH116 or CO250")).toEqual([
      "math116",
      "co250",
    ]);
  });

  it("handles trailing letters", () => {
    expect(extractCourseCodes("BUS393W or BUS415W")).toEqual([
      "bus393w",
      "bus415w",
    ]);
  });

  it("handles slash-equivalents", () => {
    expect(extractCourseCodes("AFM382/AFM481")).toEqual(["afm382", "afm481"]);
  });

  it("ignores prose without course codes", () => {
    expect(extractCourseCodes("Honours Mathematics students only")).toEqual([]);
  });
});
