import { describe, expect, it } from "vitest";
import { findUnclassified } from "../diagnostic/check-subjects";

describe("findUnclassified", () => {
  it("returns catalog prefixes absent from the known set, sorted", () => {
    const known = new Set(["cs", "math"]);
    expect(findUnclassified(["math", "zzz", "cs", "abc"], known)).toEqual([
      "abc",
      "zzz",
    ]);
  });

  it("is empty when every prefix is already classified", () => {
    const known = new Set(["cs", "math"]);
    expect(findUnclassified(["cs", "math"], known)).toEqual([]);
  });
});
