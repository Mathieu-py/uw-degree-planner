import { describe, expect, it } from "vitest";
import {
  KNOWN_TERMS,
  makeTermId,
  nextTerm,
  parseTermId,
  sequenceTermsFrom,
  termInfo,
  termLabel,
  termLabelToTermId,
} from "../terms";

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

describe("makeTermId / parseTermId", () => {
  it("encodes the observed UWFlow term IDs", () => {
    expect(makeTermId(2025, "Spring")).toBe(1255);
    expect(makeTermId(2025, "Fall")).toBe(1259);
    expect(makeTermId(2026, "Winter")).toBe(1261);
    expect(makeTermId(2026, "Spring")).toBe(1265);
    expect(makeTermId(2026, "Fall")).toBe(1269);
  });

  it("round-trips through parseTermId", () => {
    for (const id of [1241, 1255, 1259, 1261, 1265, 1269, 1281]) {
      const parsed = parseTermId(id);
      expect(parsed).not.toBeNull();
      if (!parsed) continue;
      expect(makeTermId(parsed.year, parsed.season)).toBe(id);
    }
  });

  it("returns null for IDs that don't fit the scheme", () => {
    expect(parseTermId(9999)).toBeNull();
    expect(parseTermId(1262)).toBeNull(); // bad season digit
    expect(parseTermId(500)).toBeNull();
  });

  it("rejects years outside 2000-2099", () => {
    expect(() => makeTermId(1999, "Winter")).toThrow();
    expect(() => makeTermId(2100, "Winter")).toThrow();
  });
});

describe("termInfo", () => {
  it("returns full info for a valid ID", () => {
    expect(termInfo(1261)).toEqual({
      id: 1261,
      year: 2026,
      season: "Winter",
      label: "Winter 2026",
    });
  });

  it("returns null for invalid IDs", () => {
    expect(termInfo(9999)).toBeNull();
  });
});

describe("nextTerm", () => {
  it("Winter → Spring (same year)", () => {
    const winter = termInfo(1261);
    expect(winter).not.toBeNull();
    if (!winter) return;
    expect(nextTerm(winter).label).toBe("Spring 2026");
  });

  it("Spring → Fall (same year)", () => {
    const spring = termInfo(1265);
    expect(spring).not.toBeNull();
    if (!spring) return;
    expect(nextTerm(spring).label).toBe("Fall 2026");
  });

  it("Fall → Winter (next year)", () => {
    const fall = termInfo(1259);
    expect(fall).not.toBeNull();
    if (!fall) return;
    expect(nextTerm(fall).label).toBe("Winter 2026");
    expect(nextTerm(fall).id).toBe(1261);
  });
});

describe("termLabelToTermId", () => {
  it("parses transcript-shaped labels", () => {
    expect(termLabelToTermId("Fall 2023")).toBe(1239);
    expect(termLabelToTermId("Winter 2024")).toBe(1241);
    expect(termLabelToTermId("Spring 2025")).toBe(1255);
    expect(termLabelToTermId("Fall 2025")).toBe(1259);
  });

  it("is case- and whitespace-tolerant", () => {
    expect(termLabelToTermId("  fall 2023  ")).toBe(1239);
    expect(termLabelToTermId("WINTER 2024")).toBe(1241);
  });

  it("returns null for unparseable labels", () => {
    expect(termLabelToTermId("Transfer Credit")).toBeNull();
    expect(termLabelToTermId("Summer 2024")).toBeNull();
    expect(termLabelToTermId("Fall")).toBeNull();
    expect(termLabelToTermId("")).toBeNull();
  });

  it("rejects years outside 2000-2099", () => {
    expect(termLabelToTermId("Fall 1999")).toBeNull();
    expect(termLabelToTermId("Fall 2100")).toBeNull();
  });
});

describe("sequenceTermsFrom", () => {
  it("generates a contiguous sequence", () => {
    const start = termInfo(1239);
    expect(start).not.toBeNull();
    if (!start) return;
    const seq = sequenceTermsFrom(start, 5);
    expect(seq.map((t) => t.label)).toEqual([
      "Fall 2023",
      "Winter 2024",
      "Spring 2024",
      "Fall 2024",
      "Winter 2025",
    ]);
  });
});
