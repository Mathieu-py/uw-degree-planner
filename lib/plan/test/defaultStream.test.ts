import { describe, expect, it } from "vitest";
import { PROGRAMS } from "@/lib/programsRegistry";
import { makeTermId } from "@/lib/terms";
import {
  defaultStreamFor,
  programDefaultStream,
  STREAMED_PROGRAM_IDS,
} from "../defaultStream";

describe("programDefaultStream", () => {
  it("maps the Stream 4 engineering programs", () => {
    for (const id of [
      "architectural-engineering",
      "electrical-engineering",
      "environmental-engineering",
      "geological-engineering",
    ]) {
      expect(programDefaultStream(id)).toBe("stream4");
    }
  });

  it("maps the Stream 8 engineering programs", () => {
    for (const id of [
      "biomedical-engineering",
      "civil-engineering",
      "management-engineering",
      "nanotechnology-engineering",
      "software-engineering",
    ]) {
      expect(programDefaultStream(id)).toBe("stream8");
    }
  });

  it("suggests Stream 8 for assigned dual-stream programs", () => {
    for (const id of [
      "chemical-engineering",
      "computer-engineering",
      "mechanical-engineering",
      "mechatronics-engineering",
    ]) {
      expect(programDefaultStream(id)).toBe("stream8");
    }
  });

  it("resolves Systems Design by cohort start term", () => {
    const syde = "systems-design-engineering";
    // Fall 2025 and earlier: Stream 4 (incl. the off-cycle Winter/Spring 2026).
    expect(programDefaultStream(syde, makeTermId(2024, "Fall"))).toBe(
      "stream4",
    );
    expect(programDefaultStream(syde, makeTermId(2025, "Fall"))).toBe(
      "stream4",
    );
    expect(programDefaultStream(syde, makeTermId(2026, "Winter"))).toBe(
      "stream4",
    );
    expect(programDefaultStream(syde, makeTermId(2026, "Spring"))).toBe(
      "stream4",
    );
    // Fall 2026 and later: Stream 8.
    expect(programDefaultStream(syde, makeTermId(2026, "Fall"))).toBe(
      "stream8",
    );
    expect(programDefaultStream(syde, makeTermId(2027, "Fall"))).toBe(
      "stream8",
    );
    // Unknown start term ⇒ assume the current (Fall 2026+) cohort.
    expect(programDefaultStream(syde, null)).toBe("stream8");
    expect(programDefaultStream(syde)).toBe("stream8");
  });

  it("defaults unmodeled and flexible programs to regular", () => {
    expect(programDefaultStream("architectural-studies")).toBe("regular");
    expect(programDefaultStream("medical-sciences")).toBe("regular");
    expect(programDefaultStream("h-cs")).toBe("regular");
    expect(programDefaultStream("does-not-exist")).toBe("regular");
  });
});

describe("defaultStreamFor", () => {
  it("uses the primary (first) program", () => {
    expect(
      defaultStreamFor(["software-engineering", "electrical-engineering"]),
    ).toBe("stream8");
    expect(
      defaultStreamFor(["electrical-engineering", "software-engineering"]),
    ).toBe("stream4");
  });

  it("returns null for an empty set so the caller leaves the stream alone", () => {
    expect(defaultStreamFor([])).toBeNull();
  });

  it("threads the start term through for Systems Design", () => {
    expect(
      defaultStreamFor(
        ["systems-design-engineering"],
        makeTermId(2024, "Fall"),
      ),
    ).toBe("stream4");
    expect(
      defaultStreamFor(
        ["systems-design-engineering"],
        makeTermId(2026, "Fall"),
      ),
    ).toBe("stream8");
  });
});

describe("STREAMED_PROGRAM_IDS", () => {
  it("keys every curated id to a real program (guards against slug drift)", () => {
    for (const id of STREAMED_PROGRAM_IDS) {
      expect(PROGRAMS[id], `${id} missing from programs.json`).toBeDefined();
    }
  });
});
