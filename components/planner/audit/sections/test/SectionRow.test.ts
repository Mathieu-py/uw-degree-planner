import { describe, expect, it } from "vitest";
import { groupTitle } from "../SectionRow";

describe("groupTitle — folded-group header pluralization", () => {
  it("pluralizes a singular last word and appends the count", () => {
    expect(groupTitle("Additional constraint", 7)).toBe(
      "Additional constraints · 7",
    );
  });

  it("leaves an already-plural last word alone (no double-'s')", () => {
    // Real data: two "Failed units" notes fold into one group. The last word is
    // already plural, so it must not become "Failed unitss · 2".
    expect(groupTitle("Failed units", 2)).toBe("Failed units · 2");
  });

  it("returns the bare title for a single note", () => {
    expect(groupTitle("Minimum average", 1)).toBe("Minimum average");
  });
});
