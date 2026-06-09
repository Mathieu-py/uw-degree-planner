import { describe, expect, it } from "vitest";
import type {
  ParsedCourse,
  TranscriptParseResult,
} from "../../transcript/types";
import { applyTranscriptToPlan, detectStream } from "../transcriptApply";

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
    detectedProgramIds: ["software-engineering"],
    detectedSpecializationsByProgramId: {},
    detectedCurrentTerm: null,
    detectedSystemOfStudy: "coop",
    rawPlanText: null,
    courses,
    warnings: [],
    ...overrides,
  };
}

describe("applyTranscriptToPlan — grade carry-through", () => {
  it("carries a graded course's grade onto its SlotCourse; future enrollments stay grade-less", () => {
    const parse = mkParse([
      {
        code: "cs115",
        name: "cs115",
        termLabel: "Fall 2023",
        status: "passed",
        rawGrade: "92",
      },
      {
        code: "math137",
        name: "math137",
        termLabel: "Transfer Credit",
        status: "transfer",
        rawGrade: "TR",
      },
      {
        code: "cs136",
        name: "cs136",
        termLabel: "Winter 2024",
        status: "inProgress",
        rawGrade: "",
      },
    ]);
    const { plan } = applyTranscriptToPlan(parse, {
      stream: "regular",
      includedUnrecognized: new Set(),
      mintId: makeMint(),
    });
    const find = (code: string) =>
      plan.slots.flatMap((s) => s.courses).find((c) => c.code === code);
    expect(find("cs115")?.grade).toBe("92");
    expect(find("math137")?.grade).toBe("TR");
    // Future enrollment: empty rawGrade → no grade field at all.
    expect(find("cs136")).toEqual({ code: "cs136" });
  });
});

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

describe("applyTranscriptToPlan — stream4", () => {
  it("places stream4 transcript courses into the alternating cadence", () => {
    // Stream 4 starts co-op in January of 1st year. Starting Fall 2023:
    //   1A=Fall23 → coop1=Winter24 → 1B=Spring24 → coop2=Fall24
    //   → 2A=Winter25 → coop3=Spring25 → 2B=Fall25 → ...
    // The "Winter 2024" course must land in unsortedCodes (a coop slot);
    // every other course slots into its academic term.
    const parse = mkParse([
      mkCourse("cs115", "Fall 2023"),
      mkCourse("cs136", "Spring 2024"),
      mkCourse("cs246", "Winter 2025"),
      mkCourse("cs350", "Fall 2025"),
    ]);
    const { plan, unsortedCodes } = applyTranscriptToPlan(parse, {
      stream: "stream4",
      includedUnrecognized: new Set(),
      mintId: makeMint(),
    });
    expect(plan.stream).toBe("stream4");
    expect(unsortedCodes).toEqual([]);
    const byPos = (pos: string) =>
      plan.slots.find((s) => s.position === pos)?.courses.map((c) => c.code) ??
      [];
    expect(byPos("1A")).toEqual(["cs115"]);
    expect(byPos("1B")).toEqual(["cs136"]);
    expect(byPos("2A")).toEqual(["cs246"]);
    expect(byPos("2B")).toEqual(["cs350"]);
  });
});

describe("applyTranscriptToPlan — undecodable term labels", () => {
  it("puts courses with undecodable termLabel into unsortedCodes", () => {
    const parse = mkParse([
      mkCourse("cs115", "Fall 2023"),
      mkCourse("mystery", "Whatever 9999"),
    ]);
    const { plan, unsortedCodes, unplacedTerms } = applyTranscriptToPlan(
      parse,
      {
        stream: "regular",
        includedUnrecognized: new Set(),
        mintId: makeMint(),
      },
    );
    expect(unsortedCodes).toEqual(["mystery"]);
    expect(unplacedTerms).toEqual(["Whatever 9999"]);
    expect(plan.slots.flatMap((s) => s.courses.map((c) => c.code))).toEqual([
      "cs115",
    ]);
  });
});

describe("detectStream", () => {
  it("returns 'regular' as soon as the transcript says regular system", () => {
    const parse = mkParse([mkCourse("a", "Fall 2023")], {
      detectedSystemOfStudy: "regular",
    });
    expect(detectStream(parse)).toBe("regular");
  });

  it("detects stream8 from its academic-term fingerprint (1A→1B back-to-back)", () => {
    // Stream 8 stays in class 1A (Fall 23) → 1B (Winter 24), then 2A (Fall 24).
    const parse = mkParse([
      mkCourse("a", "Fall 2023"),
      mkCourse("b", "Winter 2024"),
      mkCourse("c", "Fall 2024"),
    ]);
    expect(detectStream(parse)).toBe("stream8");
  });

  it("detects stream4 from its academic-term fingerprint (work term after 1A)", () => {
    // Stream 4 works in Winter 24, so 1B lands in Spring 24 and 2A in Winter 25.
    const parse = mkParse([
      mkCourse("a", "Fall 2023"),
      mkCourse("b", "Spring 2024"),
      mkCourse("c", "Winter 2025"),
    ]);
    expect(detectStream(parse)).toBe("stream4");
  });

  it("infers the start term from the earliest course regardless of order", () => {
    const parse = mkParse([
      mkCourse("c", "Fall 2024"),
      mkCourse("a", "Fall 2023"),
      mkCourse("b", "Winter 2024"),
    ]);
    expect(detectStream(parse)).toBe("stream8");
  });

  it("returns null when both streams fit equally (ambiguous)", () => {
    // Fall 2023 and Fall 2027 are academic terms in BOTH cadences.
    const parse = mkParse([
      mkCourse("a", "Fall 2023"),
      mkCourse("b", "Fall 2027"),
    ]);
    expect(detectStream(parse)).toBeNull();
  });

  it("returns null with fewer than two datable academic terms", () => {
    const parse = mkParse([
      mkCourse("a", "Fall 2023"),
      mkCourse("xfer", "Transfer Credit", "transfer"),
    ]);
    expect(detectStream(parse)).toBeNull();
  });

  it("returns null when the system of study is unknown", () => {
    const parse = mkParse(
      [mkCourse("a", "Fall 2023"), mkCourse("b", "Winter 2024")],
      { detectedSystemOfStudy: null },
    );
    expect(detectStream(parse)).toBeNull();
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
      detectedProgramIds: ["software-engineering"],
      detectedSpecializationsByProgramId: { "software-engineering": "ai" },
    });
    const { plan } = applyTranscriptToPlan(parse, {
      stream: "stream8",
      includedUnrecognized: new Set(),
      mintId: makeMint(),
    });
    expect(plan.programIds).toEqual(["software-engineering"]);
    expect(plan.specializationIds).toEqual({ "software-engineering": "ai" });
  });
});
