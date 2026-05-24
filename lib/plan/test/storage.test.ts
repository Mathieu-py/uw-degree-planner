import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPlan,
  emptyPlan,
  loadPlan,
  PLAN_STORAGE_KEY,
  savePlan,
} from "../storage";
import type { LocalPlan } from "../types";

const VALID_PLAN: LocalPlan = {
  version: 1,
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

  it("returns null on a payload with the wrong version", () => {
    store.setItem(
      PLAN_STORAGE_KEY,
      JSON.stringify({ ...VALID_PLAN, version: 2 }),
    );
    expect(loadPlan()).toBeNull();
  });

  it("returns null when required fields have wrong types", () => {
    store.setItem(
      PLAN_STORAGE_KEY,
      JSON.stringify({ ...VALID_PLAN, stream: "wat" }),
    );
    expect(loadPlan()).toBeNull();
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
    expect(p.version).toBe(1);
    expect(p.slots).toEqual([]);
    expect(p.stream).toBe("regular");
  });
});
