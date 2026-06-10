import { describe, expect, it } from "vitest";
import { buildEmptySlots, rebuildSlots, sequenceTerms } from "../sequence";

const makeMint = () => {
  let n = 0;
  return () => `slot-${++n}`;
};

describe("sequenceTerms — regular stream", () => {
  it("produces 8 contiguous academic terms from Fall 2023 start", () => {
    const seq = sequenceTerms(1239, "regular");
    expect(seq).toHaveLength(8);
    expect(seq.map((s) => s.position)).toEqual([
      "1A",
      "1B",
      "2A",
      "2B",
      "3A",
      "3B",
      "4A",
      "4B",
    ]);
    expect(seq.every((s) => !s.isCoop)).toBe(true);
    expect(seq[0].termId).toBe(1239);
    expect(seq[1].termId).toBe(1241); // Winter 2024
    expect(seq[2].termId).toBe(1245); // Spring 2024
  });
});

describe("sequenceTerms — shorter spans (#105)", () => {
  it("a 6-term span (Three-Year General) ends at 3B, no 4A/4B", () => {
    const seq = sequenceTerms(1239, "regular", 6);
    expect(seq.map((s) => s.position)).toEqual([
      "1A",
      "1B",
      "2A",
      "2B",
      "3A",
      "3B",
    ]);
  });

  it("truncating a co-op stream to 6 drops the work terms queued after 3B", () => {
    const seq = sequenceTerms(1239, "stream8", 6);
    // 1A 1B WT1 2A WT2 2B WT3 3A WT4 3B — coop5/coop6 (which precede 4A) are gone.
    expect(seq.map((s) => s.position)).toEqual([
      "1A",
      "1B",
      "coop1",
      "2A",
      "coop2",
      "2B",
      "coop3",
      "3A",
      "coop4",
      "3B",
    ]);
    expect(seq.filter((s) => !s.isCoop)).toHaveLength(6);
  });

  it("clamps to the full 8-term span (TermLetter ceiling) when asked for more", () => {
    expect(
      sequenceTerms(1239, "regular", 12).filter((s) => !s.isCoop),
    ).toHaveLength(8);
  });

  it("defaults to the full 8 academic terms", () => {
    expect(
      sequenceTerms(1239, "regular").filter((s) => !s.isCoop),
    ).toHaveLength(8);
  });
});

describe("sequenceTerms — stream8 co-op (May-start)", () => {
  it("matches UW's published Stream 8 cadence: 1A 1B WT1 2A WT2 2B WT3 3A WT4 3B WT5 WT6 4A 4B", () => {
    const seq = sequenceTerms(1239, "stream8");
    expect(seq).toHaveLength(14);
    expect(seq.map((s) => s.position)).toEqual([
      "1A",
      "1B",
      "coop1",
      "2A",
      "coop2",
      "2B",
      "coop3",
      "3A",
      "coop4",
      "3B",
      "coop5",
      "coop6",
      "4A",
      "4B",
    ]);
  });

  it("has 8 academic and 6 work terms", () => {
    const seq = sequenceTerms(1239, "stream8");
    expect(seq.filter((s) => !s.isCoop)).toHaveLength(8);
    expect(seq.filter((s) => s.isCoop)).toHaveLength(6);
  });

  it("calendar terms advance one season per slot regardless of kind", () => {
    const seq = sequenceTerms(1239, "stream8");
    // Fall 2023 → Winter 2024 → Spring 2024 → Fall 2024 → ...
    expect(seq[0].termId).toBe(1239);
    expect(seq[1].termId).toBe(1241);
    expect(seq[2].termId).toBe(1245);
    expect(seq[3].termId).toBe(1249);
  });

  it("has back-to-back work terms (coop5, coop6) before 4A", () => {
    const seq = sequenceTerms(1239, "stream8");
    const coop5Idx = seq.findIndex((s) => s.position === "coop5");
    expect(seq[coop5Idx + 1].position).toBe("coop6");
    expect(seq[coop5Idx + 2].position).toBe("4A");
  });
});

describe("sequenceTerms — stream4 co-op (January-start)", () => {
  it("matches UW's published Stream 4 cadence: 1A WT1 1B WT2 2A WT3 2B WT4 3A WT5 3B WT6 4A 4B", () => {
    const seq = sequenceTerms(1239, "stream4");
    expect(seq).toHaveLength(14);
    expect(seq.map((s) => s.position)).toEqual([
      "1A",
      "coop1",
      "1B",
      "coop2",
      "2A",
      "coop3",
      "2B",
      "coop4",
      "3A",
      "coop5",
      "3B",
      "coop6",
      "4A",
      "4B",
    ]);
  });

  it("has 8 academic and 6 work terms", () => {
    const seq = sequenceTerms(1239, "stream4");
    expect(seq.filter((s) => !s.isCoop)).toHaveLength(8);
    expect(seq.filter((s) => s.isCoop)).toHaveLength(6);
  });

  it("ends with 4A and 4B back-to-back (no WT between)", () => {
    const seq = sequenceTerms(1239, "stream4");
    const fourA = seq.findIndex((s) => s.position === "4A");
    expect(seq[fourA + 1].position).toBe("4B");
  });
});

describe("sequenceTerms — bad input", () => {
  it("throws on a non-decodable term id", () => {
    expect(() => sequenceTerms(9999, "regular")).toThrow();
  });
});

describe("buildEmptySlots", () => {
  it("returns one PlanSlot per cadence entry, all with empty courses", () => {
    const mint = makeMint();
    const slots = buildEmptySlots(1239, "regular", mint);
    expect(slots).toHaveLength(8);
    expect(slots.every((s) => s.courses.length === 0)).toBe(true);
    expect(slots.map((s) => s.id)).toEqual([
      "slot-1",
      "slot-2",
      "slot-3",
      "slot-4",
      "slot-5",
      "slot-6",
      "slot-7",
      "slot-8",
    ]);
  });

  it("honours a shorter span (Three-Year General → 6 slots)", () => {
    const slots = buildEmptySlots(1239, "regular", makeMint(), 6);
    expect(slots.map((s) => s.position)).toEqual([
      "1A",
      "1B",
      "2A",
      "2B",
      "3A",
      "3B",
    ]);
  });
});

describe("rebuildSlots — span change (#105)", () => {
  it("shrinking 8→6 returns courses placed in dropped terms as droppedCodes", () => {
    const eight = buildEmptySlots(1239, "regular", makeMint());
    // Place a course in 3A (kept) and one in 4B (dropped when shrinking to 6).
    eight[4].courses.push({ code: "anth301" }); // 3A
    eight[7].courses.push({ code: "anth401" }); // 4B

    const { slots, droppedCodes } = rebuildSlots(
      eight,
      1239,
      "regular",
      makeMint(),
      6,
    );
    expect(slots.map((s) => s.position)).toEqual([
      "1A",
      "1B",
      "2A",
      "2B",
      "3A",
      "3B",
    ]);
    expect(slots.find((s) => s.position === "3A")?.courses).toEqual([
      { code: "anth301" },
    ]);
    expect(droppedCodes).toEqual(["anth401"]);
  });

  it("growing 6→8 appends empty 4A/4B and keeps existing placements", () => {
    const six = buildEmptySlots(1239, "regular", makeMint(), 6);
    six[0].courses.push({ code: "anth101" }); // 1A

    const { slots, droppedCodes } = rebuildSlots(
      six,
      1239,
      "regular",
      makeMint(),
      8,
    );
    expect(slots).toHaveLength(8);
    expect(slots.at(-1)?.position).toBe("4B");
    expect(slots.find((s) => s.position === "1A")?.courses).toEqual([
      { code: "anth101" },
    ]);
    expect(droppedCodes).toEqual([]);
  });
});
