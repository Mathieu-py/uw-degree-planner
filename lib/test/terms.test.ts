import { describe, expect, it } from "vitest";
import { KNOWN_TERMS, termLabel } from "../terms";

describe("termLabel", () => {
  it("returns the human label for a known term id", () => {
    expect(termLabel(1261)).toBe("Winter 2026");
    expect(termLabel(1259)).toBe("Fall 2025");
  });

  it("falls back to a generic label for unknown ids", () => {
    expect(termLabel(9999)).toBe("Term 9999");
  });

  it("every entry in KNOWN_TERMS round-trips through termLabel", () => {
    for (const t of KNOWN_TERMS) {
      expect(termLabel(t.id)).toBe(t.label);
    }
  });
});
