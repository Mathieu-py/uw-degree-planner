import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPlan,
  emptyPlan,
  loadPlan,
  PLAN_BROKEN_BACKUP_KEY,
  PLAN_STORAGE_KEY,
  savePlan,
} from "../storage";
import type { LocalPlan } from "../types";

const VALID_PLAN: LocalPlan = {
  schemaVersion: 1,
  programId: "h-software-engineering-beng",
  specializationId: null,
  stream: "stream8",
  startTermId: 1239,
  slots: [
    {
      id: "slot-1",
      termId: 1239,
      position: "1A",
      isCoop: false,
      courses: [{ code: "cs115" }, { code: "math115", grade: "87" }],
    },
  ],
  updatedAt: "2026-05-23T12:00:00.000Z",
};

class FakeStorage {
  private data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  clear() {
    this.data.clear();
  }
}

let store: FakeStorage;

beforeEach(() => {
  store = new FakeStorage();
  vi.stubGlobal("window", { localStorage: store });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("savePlan + loadPlan", () => {
  it("round-trips a valid plan (updatedAt is refreshed on save)", () => {
    savePlan(VALID_PLAN);
    const loaded = loadPlan();
    expect(loaded).not.toBeNull();
    if (!loaded) return;
    expect(loaded.programId).toBe("h-software-engineering-beng");
    expect(loaded.slots).toHaveLength(1);
    expect(loaded.slots[0].courses[1].grade).toBe("87");
    // updatedAt was overwritten with a fresh timestamp.
    expect(loaded.updatedAt).not.toBe("2026-05-23T12:00:00.000Z");
  });

  it("returns null when nothing is stored", () => {
    expect(loadPlan()).toBeNull();
  });

  it("returns null on malformed JSON", () => {
    store.setItem(PLAN_STORAGE_KEY, "{not json");
    expect(loadPlan()).toBeNull();
  });

  it("savePlan stamps the current schemaVersion on output", () => {
    // Pass a plan whose schemaVersion field is wrong on the input; savePlan
    // should overwrite it with the current PLAN_SCHEMA_VERSION rather than
    // persisting the caller's stale value.
    const stale = {
      ...VALID_PLAN,
      schemaVersion: 999 as unknown as 1,
    } as LocalPlan;
    expect(savePlan(stale)).toBe(true);
    const raw = store.getItem(PLAN_STORAGE_KEY);
    expect(raw).not.toBeNull();
    if (!raw) return;
    expect(JSON.parse(raw).schemaVersion).toBe(1);
  });

  it("dedupes identical course codes within a single slot on save (first wins)", () => {
    const dup: LocalPlan = {
      ...VALID_PLAN,
      slots: [
        {
          id: "s1",
          termId: 1239,
          position: "1A",
          isCoop: false,
          // Same code listed twice; the second instance carries a grade that
          // should be discarded by the dedup (we keep the first occurrence).
          courses: [{ code: "cs115" }, { code: "cs115", grade: "97" }],
        },
      ],
    };
    expect(savePlan(dup)).toBe(true);
    const reloaded = loadPlan();
    expect(reloaded?.slots[0].courses).toEqual([{ code: "cs115" }]);
  });

  it("returns false (does not throw) when localStorage.setItem rejects the write", () => {
    const throwing = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };
    vi.stubGlobal("window", { localStorage: throwing });
    expect(() => savePlan(VALID_PLAN)).not.toThrow();
    expect(savePlan(VALID_PLAN)).toBe(false);
  });
});

describe("loadPlan — broken-backup behavior", () => {
  it("returns null and writes .broken backup when schemaVersion mismatches", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const wrongVersion = JSON.stringify({ ...VALID_PLAN, schemaVersion: 99 });
    store.setItem(PLAN_STORAGE_KEY, wrongVersion);
    expect(loadPlan()).toBeNull();
    expect(store.getItem(PLAN_BROKEN_BACKUP_KEY)).toBe(wrongVersion);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns null and writes .broken backup when payload is shape-incompatible", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Missing required fields entirely.
    const garbage = JSON.stringify({ schemaVersion: 1, slots: "not an array" });
    store.setItem(PLAN_STORAGE_KEY, garbage);
    expect(loadPlan()).toBeNull();
    expect(store.getItem(PLAN_BROKEN_BACKUP_KEY)).toBe(garbage);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("also writes .broken backup on malformed JSON", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    store.setItem(PLAN_STORAGE_KEY, "{nope");
    expect(loadPlan()).toBeNull();
    expect(store.getItem(PLAN_BROKEN_BACKUP_KEY)).toBe("{nope");
    warnSpy.mockRestore();
  });
});

describe("clearPlan", () => {
  it("removes the plan from storage", () => {
    savePlan(VALID_PLAN);
    clearPlan();
    expect(loadPlan()).toBeNull();
  });
});

describe("emptyPlan", () => {
  it("returns a valid-shaped plan with no slots", () => {
    const p = emptyPlan();
    expect(p.slots).toEqual([]);
    expect(p.stream).toBe("regular");
  });
});
