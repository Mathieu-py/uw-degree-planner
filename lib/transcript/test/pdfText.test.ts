import { describe, expect, it } from "vitest";
import { assembleLines } from "../pdfText";

// pdfjs's TextItem transform is [scaleX, skewY, skewX, scaleY, translateX, translateY].
// We only read indexes 4 and 5 (x, y). Synthetic items below use the same shape.
const item = (str: string, x: number, y: number) => ({
  str,
  transform: [1, 0, 0, 1, x, y],
});

describe("assembleLines", () => {
  it("groups items with the same y-coordinate into one line, ordered by x", () => {
    const out = assembleLines([
      item("Calculus", 100, 500),
      item("SYDE", 50, 500),
      item("111", 80, 500),
      item("1", 200, 500),
    ]);
    expect(out).toEqual(["SYDE 111 Calculus 1"]);
  });

  it("emits rows top-to-bottom (PDF y grows upward, so higher y first)", () => {
    const out = assembleLines([
      item("bottom", 0, 100),
      item("top", 0, 500),
      item("middle", 0, 300),
    ]);
    expect(out).toEqual(["top", "middle", "bottom"]);
  });

  it("absorbs sub-pixel y-jitter into the same row (tolerance ~2 units)", () => {
    // Cells on the same visual row may have y differing by a fraction.
    const out = assembleLines([
      item("SYDE", 50, 500.4),
      item("111", 80, 499.8),
    ]);
    expect(out).toEqual(["SYDE 111"]);
  });

  it("ignores empty-string and whitespace-only items", () => {
    const out = assembleLines([
      item("SYDE", 50, 500),
      item("", 60, 500),
      item("   ", 70, 500),
      item("111", 80, 500),
    ]);
    expect(out).toEqual(["SYDE 111"]);
  });

  it("returns an empty list for empty input", () => {
    expect(assembleLines([])).toEqual([]);
  });
});
