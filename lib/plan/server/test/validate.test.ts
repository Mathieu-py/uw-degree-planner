import { describe, expect, it } from "vitest";
import { MAX_COURSES_PER_SLOT, MAX_SLOTS } from "../serialize";
import type { PlanSnapshot } from "../types";
import { MAX_ID_LEN, MAX_PROGRAM_IDS, snapshotError } from "../validate";

const UUID_A = "00000000-0000-4000-8000-000000000000";
const UUID_B = "11111111-1111-4111-8111-111111111111";

function slot(id: string, courseCount = 1): PlanSnapshot["slots"][number] {
  return {
    id,
    termId: null,
    position: "pre",
    isCoop: false,
    courses: Array.from({ length: courseCount }, (_, i) => ({
      code: `cs${i}`,
    })),
  };
}

function snapshot(over: Partial<PlanSnapshot> = {}): PlanSnapshot {
  return {
    programIds: ["h-software-engineering-beng"],
    specializationIds: {},
    acknowledgedRequirements: {},
    stream: "stream8",
    startTermId: 1239,
    programScrapeVersion: null,
    slots: [slot(UUID_A)],
    ...over,
  };
}

describe("snapshotError — size caps", () => {
  it("accepts a normal-sized plan", () => {
    expect(snapshotError(snapshot())).toBeNull();
  });

  it("accepts exactly the caps", () => {
    const slots = Array.from({ length: MAX_SLOTS }, (_, i) =>
      // Distinct UUIDs so the dedupe refine doesn't trip; vary the last hextet.
      slot(
        `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        MAX_COURSES_PER_SLOT,
      ),
    );
    expect(snapshotError(snapshot({ slots }))).toBeNull();
  });

  it("rejects too many slots with snapshot_too_large", () => {
    const slots = Array.from({ length: MAX_SLOTS + 1 }, (_, i) =>
      slot(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, 0),
    );
    expect(snapshotError(snapshot({ slots }))).toBe("snapshot_too_large");
  });

  it("rejects too many courses in a single slot with snapshot_too_large", () => {
    expect(
      snapshotError(
        snapshot({ slots: [slot(UUID_A, MAX_COURSES_PER_SLOT + 1)] }),
      ),
    ).toBe("snapshot_too_large");
  });
});

describe("snapshotError — structural validation", () => {
  it("rejects a non-UUID slot id before the RPC", () => {
    expect(snapshotError(snapshot({ slots: [slot("not-a-uuid")] }))).toBe(
      "invalid_snapshot",
    );
  });

  it("rejects an unknown stream value", () => {
    expect(
      snapshotError(snapshot({ stream: "stream2" as PlanSnapshot["stream"] })),
    ).toBe("invalid_snapshot");
  });

  it("rejects an unknown slot position", () => {
    const bad = {
      ...slot(UUID_A),
      position: "5C",
    } as unknown as PlanSnapshot["slots"][number];
    expect(snapshotError(snapshot({ slots: [bad] }))).toBe("invalid_snapshot");
  });

  it("rejects duplicate slot ids", () => {
    expect(
      snapshotError(snapshot({ slots: [slot(UUID_A), slot(UUID_A)] })),
    ).toBe("invalid_snapshot");
  });

  it("rejects duplicate programIds", () => {
    expect(snapshotError(snapshot({ programIds: ["h-cs", "h-cs"] }))).toBe(
      "invalid_snapshot",
    );
  });

  it("accepts distinct multi-program ids in order", () => {
    expect(
      snapshotError(snapshot({ programIds: ["h-cs", "h-stats"] })),
    ).toBeNull();
  });

  it("rejects too many programIds", () => {
    const programIds = Array.from(
      { length: MAX_PROGRAM_IDS + 1 },
      (_, i) => `p${i}`,
    );
    expect(snapshotError(snapshot({ programIds }))).toBe("invalid_snapshot");
  });

  it("rejects an over-length program id", () => {
    expect(
      snapshotError(snapshot({ programIds: ["x".repeat(MAX_ID_LEN + 1)] })),
    ).toBe("invalid_snapshot");
  });

  it("rejects an over-length specialization value", () => {
    expect(
      snapshotError(
        snapshot({ specializationIds: { "h-cs": "y".repeat(MAX_ID_LEN + 1) } }),
      ),
    ).toBe("invalid_snapshot");
  });

  it("rejects an over-length course code", () => {
    const bad = {
      ...slot(UUID_B),
      courses: [{ code: "c".repeat(64) }],
    };
    expect(snapshotError(snapshot({ slots: [bad] }))).toBe("invalid_snapshot");
  });

  it("rejects an over-length grade", () => {
    const bad = {
      ...slot(UUID_B),
      courses: [{ code: "cs115", grade: "g".repeat(64) }],
    };
    expect(snapshotError(snapshot({ slots: [bad] }))).toBe("invalid_snapshot");
  });

  it("accepts a valid specialization map and null metadata", () => {
    expect(
      snapshotError(
        snapshot({
          specializationIds: { "h-software-engineering-beng": "ai" },
          stream: null,
          startTermId: null,
          programScrapeVersion: null,
        }),
      ),
    ).toBeNull();
  });
});
