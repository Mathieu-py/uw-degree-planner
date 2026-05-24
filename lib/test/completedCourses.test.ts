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

const COMPLETED_KEY = "uwfinder.completedCourses";
const EXTRAS_KEY = "uwfinder.completedCoursesExtras";
const PRIMARY_SOURCE_KEY = "uwfinder.completedCoursesPrimarySource";
const LEGACY_FLAG_KEY = "uwfinder.completedCoursesFromTranscript";

beforeEach(() => {
  storage.store.clear();
});

describe("loadCompletedCourses", () => {
  it("returns [] when nothing is stored", async () => {
    const { loadCompletedCourses } = await import("../completedCourses");
    expect(loadCompletedCourses()).toEqual([]);
  });

  it("parses a JSON array of course codes", async () => {
    storage.store.set(COMPLETED_KEY, JSON.stringify(["cs115", "math116"]));
    const { loadCompletedCourses } = await import("../completedCourses");
    expect(loadCompletedCourses()).toEqual(["cs115", "math116"]);
  });

  it("lowercases stored codes", async () => {
    storage.store.set(COMPLETED_KEY, JSON.stringify(["CS115", "Math116"]));
    const { loadCompletedCourses } = await import("../completedCourses");
    expect(loadCompletedCourses()).toEqual(["cs115", "math116"]);
  });

  it("returns [] and clears the key on malformed JSON", async () => {
    storage.store.set(COMPLETED_KEY, "not-json{");
    const { loadCompletedCourses } = await import("../completedCourses");
    expect(loadCompletedCourses()).toEqual([]);
    expect(storage.store.has(COMPLETED_KEY)).toBe(false);
  });

  it("returns [] and clears the key when stored value is not an array", async () => {
    storage.store.set(COMPLETED_KEY, JSON.stringify({ codes: ["cs115"] }));
    const { loadCompletedCourses } = await import("../completedCourses");
    expect(loadCompletedCourses()).toEqual([]);
    expect(storage.store.has(COMPLETED_KEY)).toBe(false);
  });

  it("filters out non-string items", async () => {
    storage.store.set(
      COMPLETED_KEY,
      JSON.stringify(["cs115", 42, null, "math116", true]),
    );
    const { loadCompletedCourses } = await import("../completedCourses");
    expect(loadCompletedCourses()).toEqual(["cs115", "math116"]);
  });
});

describe("saveCompletedCourses", () => {
  it("writes the list as a JSON array", async () => {
    const { saveCompletedCourses } = await import("../completedCourses");
    saveCompletedCourses(["cs115", "math116"]);
    expect(storage.store.get(COMPLETED_KEY)).toBe(
      JSON.stringify(["cs115", "math116"]),
    );
  });

  it("round-trips through load", async () => {
    const { loadCompletedCourses, saveCompletedCourses } = await import(
      "../completedCourses"
    );
    saveCompletedCourses(["cs115", "math116", "syde101"]);
    expect(loadCompletedCourses()).toEqual(["cs115", "math116", "syde101"]);
  });
});

describe("extras layer", () => {
  it("loadExtras returns [] when nothing is stored", async () => {
    const { loadExtras } = await import("../completedCourses");
    expect(loadExtras()).toEqual([]);
  });

  it("saveExtras → loadExtras round-trip", async () => {
    const { loadExtras, saveExtras } = await import("../completedCourses");
    saveExtras(["econ101", "phil202"]);
    expect(loadExtras()).toEqual(["econ101", "phil202"]);
  });

  it("loadExtras is defensive against malformed JSON", async () => {
    storage.store.set(EXTRAS_KEY, "garbage{");
    const { loadExtras } = await import("../completedCourses");
    expect(loadExtras()).toEqual([]);
    expect(storage.store.has(EXTRAS_KEY)).toBe(false);
  });

  it("loadExtras lowercases stored codes", async () => {
    storage.store.set(EXTRAS_KEY, JSON.stringify(["ECON101", "Phil202"]));
    const { loadExtras } = await import("../completedCourses");
    expect(loadExtras()).toEqual(["econ101", "phil202"]);
  });

  it("extras storage is independent of completedCourses storage", async () => {
    const { loadCompletedCourses, loadExtras, saveCompletedCourses, saveExtras } =
      await import("../completedCourses");
    saveCompletedCourses(["cs115"]);
    saveExtras(["econ101"]);
    expect(loadCompletedCourses()).toEqual(["cs115"]);
    expect(loadExtras()).toEqual(["econ101"]);
  });
});

describe("primarySource", () => {
  it("returns null on a fresh store", async () => {
    const { loadPrimarySource } = await import("../completedCourses");
    expect(loadPrimarySource()).toBeNull();
  });

  it("save → load round-trip for 'transcript'", async () => {
    const { loadPrimarySource, savePrimarySource } = await import(
      "../completedCourses"
    );
    savePrimarySource("transcript");
    expect(loadPrimarySource()).toBe("transcript");
    expect(storage.store.get(PRIMARY_SOURCE_KEY)).toBe("transcript");
  });

  it("save → load round-trip for 'baseline'", async () => {
    const { loadPrimarySource, savePrimarySource } = await import(
      "../completedCourses"
    );
    savePrimarySource("baseline");
    expect(loadPrimarySource()).toBe("baseline");
  });

  it("saving null removes the key", async () => {
    const { loadPrimarySource, savePrimarySource } = await import(
      "../completedCourses"
    );
    savePrimarySource("transcript");
    savePrimarySource(null);
    expect(loadPrimarySource()).toBeNull();
    expect(storage.store.has(PRIMARY_SOURCE_KEY)).toBe(false);
  });

  it("clears and ignores stored garbage values", async () => {
    storage.store.set(PRIMARY_SOURCE_KEY, "junk");
    const { loadPrimarySource } = await import("../completedCourses");
    expect(loadPrimarySource()).toBeNull();
    expect(storage.store.has(PRIMARY_SOURCE_KEY)).toBe(false);
  });

  it("migrates legacy '1' flag to 'transcript' and clears the legacy key", async () => {
    storage.store.set(LEGACY_FLAG_KEY, "1");
    const { loadPrimarySource } = await import("../completedCourses");
    expect(loadPrimarySource()).toBe("transcript");
    expect(storage.store.has(LEGACY_FLAG_KEY)).toBe(false);
    expect(storage.store.get(PRIMARY_SOURCE_KEY)).toBe("transcript");
  });

  it("migrates other legacy flag values by clearing and falling back", async () => {
    storage.store.set(LEGACY_FLAG_KEY, "true");
    const { loadPrimarySource } = await import("../completedCourses");
    expect(loadPrimarySource()).toBeNull();
    expect(storage.store.has(LEGACY_FLAG_KEY)).toBe(false);
  });

  it("infers 'baseline' when no flag exists but completedCourses is non-empty", async () => {
    storage.store.set(COMPLETED_KEY, JSON.stringify(["cs115", "math116"]));
    const { loadPrimarySource } = await import("../completedCourses");
    expect(loadPrimarySource()).toBe("baseline");
    expect(storage.store.get(PRIMARY_SOURCE_KEY)).toBe("baseline");
  });
});

describe("rebaseCompletedCourses (primary + extras)", () => {
  it("returns just the baseline when extras is empty (first seed)", async () => {
    const { rebaseCompletedCourses } = await import("../completedCourses");
    const { inferCompleted } = await import("../programs");
    const rebased = rebaseCompletedCourses([], {
      programId: "systems-design-engineering",
      currentTerm: "3A",
      specializationId: null,
      choiceGroupSelections: {},
    });
    expect(rebased).toEqual(inferCompleted("systems-design-engineering", "3A"));
  });

  it("unions extras into the baseline", async () => {
    const { rebaseCompletedCourses } = await import("../completedCourses");
    const { inferCompleted } = await import("../programs");
    const rebased = rebaseCompletedCourses(["econ101"], {
      programId: "systems-design-engineering",
      currentTerm: "3A",
      specializationId: null,
      choiceGroupSelections: {},
    });
    expect(rebased).toContain("econ101");
    for (const c of inferCompleted("systems-design-engineering", "3A")) {
      expect(rebased).toContain(c);
    }
  });

  it("preserves extras when the program changes", async () => {
    const { rebaseCompletedCourses } = await import("../completedCourses");
    const { inferCompleted } = await import("../programs");
    const rebased = rebaseCompletedCourses(["econ101"], {
      programId: "systems-design-engineering",
      currentTerm: "3B",
      specializationId: null,
      choiceGroupSelections: {},
    });
    expect(rebased).toContain("econ101");
    for (const c of inferCompleted("systems-design-engineering", "3B")) {
      expect(rebased).toContain(c);
    }
  });

  it("clearing program/term leaves only the extras (empty baseline)", async () => {
    const { rebaseCompletedCourses } = await import("../completedCourses");
    const rebased = rebaseCompletedCourses(["econ101", "phil202"], {
      programId: null,
      currentTerm: null,
      specializationId: null,
      choiceGroupSelections: {},
    });
    expect(rebased).toEqual(["econ101", "phil202"]);
  });

  it("removals do NOT persist across a re-seed — a previously-removed baseline course reappears", async () => {
    const { rebaseCompletedCourses } = await import("../completedCourses");
    const { inferCompleted } = await import("../programs");
    // The user removed `removed` mid-seed; the only state preserved across
    // re-seed is the extras layer, which does not contain `removed`. After
    // rebase the new baseline brings the course back.
    const syde3B = inferCompleted("systems-design-engineering", "3B");
    const removed = syde3B[0];
    const rebased = rebaseCompletedCourses([], {
      programId: "systems-design-engineering",
      currentTerm: "3B",
      specializationId: null,
      choiceGroupSelections: {},
    });
    expect(rebased).toContain(removed);
  });

  it("seeds full requiredCourses when switching to a flexible program with null term", async () => {
    const { rebaseCompletedCourses } = await import("../completedCourses");
    const { PROGRAMS, getRequiredCourses } = await import("../programs");
    const biology = PROGRAMS["h-biology"];
    if (biology?.kind !== "flexible")
      throw new Error("expected h-biology to be flexible after scrape");

    const rebased = rebaseCompletedCourses([], {
      programId: "h-biology",
      currentTerm: null,
      specializationId: null,
      choiceGroupSelections: {},
    });
    expect(rebased).toEqual(getRequiredCourses(biology));
  });

  it("preserves extras when rebasing between engineering and flexible programs", async () => {
    const { rebaseCompletedCourses } = await import("../completedCourses");
    const { PROGRAMS, getRequiredCourses } = await import("../programs");
    const biology = PROGRAMS["h-biology"];
    if (biology?.kind !== "flexible")
      throw new Error("expected h-biology to be flexible after scrape");

    const rebased = rebaseCompletedCourses(["extra101"], {
      programId: "h-biology",
      currentTerm: null,
      specializationId: null,
      choiceGroupSelections: {},
    });
    expect(rebased).toContain("extra101");
    for (const c of getRequiredCourses(biology)) {
      expect(rebased).toContain(c);
    }
  });

  it("dedupes when extras overlap with the baseline", async () => {
    const { rebaseCompletedCourses, baselineForPassage } = await import(
      "../completedCourses"
    );
    const baseline = baselineForPassage(
      "systems-design-engineering",
      "3A",
      null,
      {},
    );
    const shared = baseline[0];
    const rebased = rebaseCompletedCourses([shared, "econ101"], {
      programId: "systems-design-engineering",
      currentTerm: "3A",
      specializationId: null,
      choiceGroupSelections: {},
    });
    expect(rebased.filter((c) => c === shared)).toHaveLength(1);
    expect(rebased).toContain("econ101");
  });

  it("adding a specialization unions in its required courses", async () => {
    const { rebaseCompletedCourses, baselineForPassage } = await import(
      "../completedCourses"
    );
    const parent = "3g-english-literature-and-rhetoric";
    const spec = "engl-communication-design";
    const rebased = rebaseCompletedCourses([], {
      programId: parent,
      currentTerm: null,
      specializationId: spec,
      choiceGroupSelections: {},
    });
    const withSpec = baselineForPassage(parent, null, spec, {});
    for (const c of withSpec) expect(rebased).toContain(c);
  });

  it("dropping a specialization removes its baseline-only courses unless they're in extras", async () => {
    const { rebaseCompletedCourses, baselineForPassage } = await import(
      "../completedCourses"
    );
    const parent = "3g-english-literature-and-rhetoric";
    const spec = "engl-communication-design";
    const withSpec = baselineForPassage(parent, null, spec, {});
    const parentOnly = baselineForPassage(parent, null, null, {});
    const specOnly = withSpec.filter((c) => !parentOnly.includes(c));
    // Fixture sanity: this test only proves anything if the spec contributes
    // at least one required course the parent doesn't already require.
    expect(specOnly.length).toBeGreaterThan(0);

    const rebased = rebaseCompletedCourses([], {
      programId: parent,
      currentTerm: null,
      specializationId: null,
      choiceGroupSelections: {},
    });
    for (const c of specOnly) expect(rebased).not.toContain(c);
    for (const c of parentOnly) expect(rebased).toContain(c);
  });

  it("adding a choice-group pick unions it into the baseline", async () => {
    const { rebaseCompletedCourses, baselineForPassage } = await import(
      "../completedCourses"
    );
    const before = baselineForPassage("electrical-engineering", "2A", null, {});
    expect(before).not.toContain("commst192");

    const rebased = rebaseCompletedCourses([], {
      programId: "electrical-engineering",
      currentTerm: "2A",
      specializationId: null,
      choiceGroupSelections: { "1A.0.1": ["commst192"] },
    });
    expect(rebased).toContain("commst192");
  });

  it("clearing choice-group picks drops the picked codes", async () => {
    const { rebaseCompletedCourses } = await import("../completedCourses");
    const rebased = rebaseCompletedCourses([], {
      programId: "electrical-engineering",
      currentTerm: "2A",
      specializationId: null,
      choiceGroupSelections: {},
    });
    expect(rebased).not.toContain("commst192");
  });

  it("baselineForPassage drops stale paths that don't resolve in the current program", async () => {
    const { baselineForPassage } = await import("../completedCourses");
    const baseline = baselineForPassage("electrical-engineering", "2A", null, {
      "9Z.99.99": ["fake-course"],
    });
    expect(baseline).not.toContain("fake-course");
  });
});
