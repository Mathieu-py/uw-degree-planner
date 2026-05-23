import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  store: new Map<string, string>(),
}));

vi.mock("../storage", () => ({
  safeGetItem: (key: string) => storage.store.get(key) ?? null,
  safeSetItem: (key: string, value: string) => {
    storage.store.set(key, value);
  },
  safeRemoveItem: (key: string) => {
    storage.store.delete(key);
  },
}));

const KEY = "uwfinder.completedCourses";

beforeEach(() => {
  storage.store.clear();
});

describe("loadCompletedCourses", () => {
  it("returns [] when nothing is stored", async () => {
    const { loadCompletedCourses } = await import("../completedCourses");
    expect(loadCompletedCourses()).toEqual([]);
  });

  it("parses a JSON array of course codes", async () => {
    storage.store.set(KEY, JSON.stringify(["cs115", "math116"]));
    const { loadCompletedCourses } = await import("../completedCourses");
    expect(loadCompletedCourses()).toEqual(["cs115", "math116"]);
  });

  it("lowercases stored codes", async () => {
    storage.store.set(KEY, JSON.stringify(["CS115", "Math116"]));
    const { loadCompletedCourses } = await import("../completedCourses");
    expect(loadCompletedCourses()).toEqual(["cs115", "math116"]);
  });

  it("returns [] and clears the key on malformed JSON", async () => {
    storage.store.set(KEY, "not-json{");
    const { loadCompletedCourses } = await import("../completedCourses");
    expect(loadCompletedCourses()).toEqual([]);
    expect(storage.store.has(KEY)).toBe(false);
  });

  it("returns [] and clears the key when stored value is not an array", async () => {
    storage.store.set(KEY, JSON.stringify({ codes: ["cs115"] }));
    const { loadCompletedCourses } = await import("../completedCourses");
    expect(loadCompletedCourses()).toEqual([]);
    expect(storage.store.has(KEY)).toBe(false);
  });

  it("filters out non-string items", async () => {
    storage.store.set(
      KEY,
      JSON.stringify(["cs115", 42, null, "math116", true]),
    );
    const { loadCompletedCourses } = await import("../completedCourses");
    expect(loadCompletedCourses()).toEqual(["cs115", "math116"]);
  });
});

describe("rebaseCompletedCourses", () => {
  it("returns the new baseline on a first seed (null/null → syde/3A)", async () => {
    const { rebaseCompletedCourses } = await import("../completedCourses");
    const { inferCompleted } = await import("../programs");
    const rebased = rebaseCompletedCourses(
      { programId: null, currentTerm: null, completedCourses: [] },
      "systems-design-engineering",
      "3A",
    );
    expect(rebased).toEqual(inferCompleted("systems-design-engineering", "3A"));
  });

  it("returns the new baseline when prog stays the same but term advances", async () => {
    const { rebaseCompletedCourses } = await import("../completedCourses");
    const { inferCompleted } = await import("../programs");
    const rebased = rebaseCompletedCourses(
      {
        programId: "systems-design-engineering",
        currentTerm: "3A",
        completedCourses: inferCompleted("systems-design-engineering", "3A"),
      },
      "systems-design-engineering",
      "3B",
    );
    expect(rebased).toEqual(inferCompleted("systems-design-engineering", "3B"));
  });

  it("preserves extras the user added beyond the old baseline", async () => {
    const { rebaseCompletedCourses } = await import("../completedCourses");
    const { inferCompleted } = await import("../programs");
    const oldList = [
      ...inferCompleted("systems-design-engineering", "3A"),
      "econ101",
    ].sort();
    const rebased = rebaseCompletedCourses(
      {
        programId: "systems-design-engineering",
        currentTerm: "3A",
        completedCourses: oldList,
      },
      "systems-design-engineering",
      "3B",
    );
    expect(rebased).toContain("econ101");
    for (const c of inferCompleted("systems-design-engineering", "3B")) {
      expect(rebased).toContain(c);
    }
  });

  it("preserves removals: a baseline course the user cleared stays cleared after rebase", async () => {
    const { rebaseCompletedCourses } = await import("../completedCourses");
    const { inferCompleted } = await import("../programs");
    const syde3A = inferCompleted("systems-design-engineering", "3A");
    const syde3B = inferCompleted("systems-design-engineering", "3B");
    const removed = syde3A[0];
    expect(syde3B).toContain(removed);

    const oldList = syde3A.filter((c) => c !== removed);
    const rebased = rebaseCompletedCourses(
      {
        programId: "systems-design-engineering",
        currentTerm: "3A",
        completedCourses: oldList,
      },
      "systems-design-engineering",
      "3B",
    );
    expect(rebased).not.toContain(removed);
  });

  it("clearing prog/term drops baseline-derived courses but keeps manually-added extras", async () => {
    const { rebaseCompletedCourses } = await import("../completedCourses");
    const { inferCompleted } = await import("../programs");
    const oldList = [
      ...inferCompleted("systems-design-engineering", "3A"),
      "econ101",
    ].sort();
    const rebased = rebaseCompletedCourses(
      {
        programId: "systems-design-engineering",
        currentTerm: "3A",
        completedCourses: oldList,
      },
      null,
      null,
    );
    expect(rebased).toEqual(["econ101"]);
  });

  it("seeds full requiredCourses when switching to a flexible program with null term", async () => {
    const { rebaseCompletedCourses } = await import("../completedCourses");
    const { PROGRAMS, getRequiredCourses } = await import("../programs");
    const biology = PROGRAMS["h-biology"];
    if (biology?.kind !== "flexible")
      throw new Error("expected h-biology to be flexible after scrape");

    const rebased = rebaseCompletedCourses(
      { programId: null, currentTerm: null, completedCourses: [] },
      "h-biology",
      null,
    );
    expect(rebased).toEqual(getRequiredCourses(biology));
  });

  it("preserves extras when rebasing between engineering and flexible programs", async () => {
    const { rebaseCompletedCourses } = await import("../completedCourses");
    const { inferCompleted, PROGRAMS, getRequiredCourses } = await import(
      "../programs"
    );
    const biology = PROGRAMS["h-biology"];
    if (biology?.kind !== "flexible")
      throw new Error("expected h-biology to be flexible after scrape");

    const oldList = [
      ...inferCompleted("systems-design-engineering", "2A"),
      "extra101",
    ];
    const rebased = rebaseCompletedCourses(
      {
        programId: "systems-design-engineering",
        currentTerm: "2A",
        completedCourses: oldList,
      },
      "h-biology",
      null,
    );
    expect(rebased).toContain("extra101");
    for (const c of getRequiredCourses(biology)) {
      expect(rebased).toContain(c);
    }
  });

  it("no-op rebase (same prog/term) returns the same effective list", async () => {
    const { rebaseCompletedCourses } = await import("../completedCourses");
    const { inferCompleted } = await import("../programs");
    const list = [
      ...inferCompleted("systems-design-engineering", "3A"),
      "econ101",
    ].sort();
    const rebased = rebaseCompletedCourses(
      {
        programId: "systems-design-engineering",
        currentTerm: "3A",
        completedCourses: list,
      },
      "systems-design-engineering",
      "3A",
    );
    expect(rebased).toEqual(list);
  });
});

describe("saveCompletedCourses", () => {
  it("writes the list as a JSON array", async () => {
    const { saveCompletedCourses } = await import("../completedCourses");
    saveCompletedCourses(["cs115", "math116"]);
    expect(storage.store.get(KEY)).toBe(JSON.stringify(["cs115", "math116"]));
  });

  it("round-trips through load", async () => {
    const { loadCompletedCourses, saveCompletedCourses } = await import(
      "../completedCourses"
    );
    saveCompletedCourses(["cs115", "math116", "syde101"]);
    expect(loadCompletedCourses()).toEqual(["cs115", "math116", "syde101"]);
  });

  it("overwrites the previous value", async () => {
    const { loadCompletedCourses, saveCompletedCourses } = await import(
      "../completedCourses"
    );
    saveCompletedCourses(["cs115"]);
    saveCompletedCourses(["math116"]);
    expect(loadCompletedCourses()).toEqual(["math116"]);
  });
});

describe("transcript flag", () => {
  const FLAG_KEY = "uwfinder.completedCoursesFromTranscript";

  it("isCompletedFromTranscript returns false on a fresh store", async () => {
    const { isCompletedFromTranscript } = await import("../completedCourses");
    expect(isCompletedFromTranscript()).toBe(false);
  });

  it("mark → is → clear round-trip", async () => {
    const {
      clearCompletedFromTranscriptFlag,
      isCompletedFromTranscript,
      markCompletedFromTranscript,
    } = await import("../completedCourses");
    markCompletedFromTranscript();
    expect(isCompletedFromTranscript()).toBe(true);
    expect(storage.store.get(FLAG_KEY)).toBe("1");
    clearCompletedFromTranscriptFlag();
    expect(isCompletedFromTranscript()).toBe(false);
    expect(storage.store.has(FLAG_KEY)).toBe(false);
  });

  it("is independent of the completedCourses list", async () => {
    const {
      clearCompletedFromTranscriptFlag,
      isCompletedFromTranscript,
      loadCompletedCourses,
      markCompletedFromTranscript,
      saveCompletedCourses,
    } = await import("../completedCourses");

    // Setting the flag does not touch the courses list.
    markCompletedFromTranscript();
    expect(loadCompletedCourses()).toEqual([]);

    // Saving courses does not touch the flag.
    saveCompletedCourses(["cs115"]);
    expect(isCompletedFromTranscript()).toBe(true);

    // Clearing the flag does not touch the courses list.
    clearCompletedFromTranscriptFlag();
    expect(loadCompletedCourses()).toEqual(["cs115"]);
  });

  it("ignores stored values other than '1'", async () => {
    const { isCompletedFromTranscript } = await import("../completedCourses");
    storage.store.set(FLAG_KEY, "true");
    expect(isCompletedFromTranscript()).toBe(false);
    storage.store.set(FLAG_KEY, "0");
    expect(isCompletedFromTranscript()).toBe(false);
  });
});
