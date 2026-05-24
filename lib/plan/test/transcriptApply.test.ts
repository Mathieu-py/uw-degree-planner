import { describe, expect, it } from "vitest";
import type {
  ParsedCourse,
  TranscriptParseResult,
} from "../../transcript/types";
import { applyTranscriptToPlan } from "../transcriptApply";

const makeMint = () => {
  let n = 0;
  return () => `slot-${++n}`;
};

function mkCourse(
  code: string,
  termLabel: string,
  status: ParsedCourse["status"] = "passed",
): ParsedCourse {
  return { code, name: code, termLabel, status, rawGrade: "" };
}

function mkParse(
  courses: ParsedCourse[],
  overrides: Partial<TranscriptParseResult> = {},
): TranscriptParseResult {
  return {
    detectedProgramId: "software-engineering",
    detectedSpecializationSlug: null,
    detectedCurrentTerm: null,
    detectedSystemOfStudy: "coop",
    rawPlanText: null,
    courses,
    warnings: [],
    ...overrides,
  };
}

describe("applyTranscriptToPlan — stream8 start Fall 2023", () => {
  it("places passed courses into the matching academic term and builds the cadence forward", () => {
    const parse = mkParse([
      mkCourse("cs115", "Fall 2023"),
      mkCourse("math115", "Fall 2023"),
      mkCourse("cs136", "Winter 2024"),
    ]);
    const { plan, unsortedCodes } = applyTranscriptToPlan(parse, {
      stream: "stream8",
      includedUnrecognized: new Set(),
      mintId: makeMint(),
    });
    expect(plan.startTermId).toBe(1239);
    expect(plan.stream).toBe("stream8");
    // 14-slot stream8 cadence + 1 pre slot = 15 slots.
    expect(plan.slots).toHaveLength(15);

    const fall23 = plan.slots.find((s) => s.position === "1A");
    expect(fall23?.courses.map((c) => c.code).sort()).toEqual([
      "cs115",
      "math115",
    ]);
    const winter24 = plan.slots.find((s) => s.position === "1B");
    expect(winter24?.courses.map((c) => c.code)).toEqual(["cs136"]);
    expect(unsortedCodes).toEqual([]);
  });

  it("places transfer credits into the pre slot regardless of termLabel", () => {
    const parse = mkParse([
      mkCourse("xfer1", "Transfer Credit", "transfer"),
      mkCourse("cs115", "Fall 2023"),
    ]);
    const { plan } = applyTranscriptToPlan(parse, {
      stream: "stream8",
      includedUnrecognized: new Set(),
      mintId: makeMint(),
    });
    const pre = plan.slots.find((s) => s.position === "pre");
    expect(pre?.courses.map((c) => c.code)).toEqual(["xfer1"]);
  });

  it("drops skipped courses entirely", () => {
    const parse = mkParse([
      mkCourse("dropped", "Fall 2023", "skipped"),
      mkCourse("cs115", "Fall 2023"),
    ]);
    const { plan } = applyTranscriptToPlan(parse, {
      stream: "stream8",
      includedUnrecognized: new Set(),
      mintId: makeMint(),
    });
    const all = plan.slots.flatMap((s) => s.courses.map((c) => c.code));
    expect(all).not.toContain("dropped");
    expect(all).toContain("cs115");
  });

  it("includes unrecognized courses only when explicitly opted in", () => {
    const parse = mkParse([
      mkCourse("weirdo", "Fall 2023", "unrecognized"),
      mkCourse("alsoweird", "Fall 2023", "unrecognized"),
      mkCourse("cs115", "Fall 2023"),
    ]);
    const { plan } = applyTranscriptToPlan(parse, {
      stream: "stream8",
      includedUnrecognized: new Set(["weirdo"]),
      mintId: makeMint(),
    });
    const codes = plan.slots
      .flatMap((s) => s.courses.map((c) => c.code))
      .sort();
    expect(codes).toEqual(["cs115", "weirdo"]);
  });

  it("routes courses whose term falls on a work slot to unsortedCodes", () => {
    // Stream 8: Spring 2024 (1245) is coop1, not an academic slot. A course
    // taken in Spring 2024 cannot be placed onto the cadence — it shows up
    // in unsortedCodes for manual placement.
    const parse = mkParse([
      mkCourse("cs115", "Fall 2023"),
      mkCourse("oddcourse", "Spring 2024"),
    ]);
    const { plan, unsortedCodes, unplacedTerms } = applyTranscriptToPlan(
      parse,
      {
        stream: "stream8",
        includedUnrecognized: new Set(),
        mintId: makeMint(),
      },
    );
    expect(unsortedCodes).toEqual(["oddcourse"]);
    expect(unplacedTerms).toEqual(["Spring 2024"]);
    expect(plan.slots.flatMap((s) => s.courses.map((c) => c.code))).toEqual([
      "cs115",
    ]);
  });
});

describe("applyTranscriptToPlan — regular stream", () => {
  it("treats Spring terms as academic in the regular cadence", () => {
    const parse = mkParse([
      mkCourse("a", "Fall 2023"),
      mkCourse("b", "Winter 2024"),
      mkCourse("c", "Spring 2024"),
    ]);
    const { plan, unsortedCodes } = applyTranscriptToPlan(parse, {
      stream: "regular",
      includedUnrecognized: new Set(),
      mintId: makeMint(),
    });
    expect(unsortedCodes).toEqual([]);
    expect(plan.slots.find((s) => s.position === "2A")?.courses).toEqual([
      { code: "c" },
    ]);
  });
});

describe("applyTranscriptToPlan — empty / degenerate cases", () => {
  it("returns an empty-slots plan when no parseable terms exist", () => {
    const parse = mkParse([mkCourse("xfer", "Transfer Credit", "transfer")]);
    const { plan } = applyTranscriptToPlan(parse, {
      stream: "regular",
      includedUnrecognized: new Set(),
      mintId: makeMint(),
    });
    expect(plan.startTermId).toBeNull();
    expect(plan.slots).toEqual([]);
  });

  it("propagates detected program and specialization onto the plan", () => {
    const parse = mkParse([mkCourse("cs115", "Fall 2023")], {
      detectedProgramId: "software-engineering",
      detectedSpecializationSlug: "ai",
    });
    const { plan } = applyTranscriptToPlan(parse, {
      stream: "stream8",
      includedUnrecognized: new Set(),
      mintId: makeMint(),
    });
    expect(plan.programId).toBe("software-engineering");
    expect(plan.specializationId).toBe("ai");
  });
});
