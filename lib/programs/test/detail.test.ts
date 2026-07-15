import { describe, expect, it, vi } from "vitest";
import { createProgramDetailStore } from "../detail";
import type { Program } from "../index";

function mkProgram(codes: string[], spec?: string[]): Program {
  return {
    kind: "flexible",
    name: "Testing (Bachelor of Testing)",
    asOf: "2026-01-01",
    rules: { kind: "courses", courses: codes },
    ...(spec
      ? {
          specializations: [
            {
              slug: "spec",
              name: "Spec",
              kualiId: "k-spec",
              rules: { kind: "courses" as const, courses: spec },
            },
          ],
        }
      : {}),
  };
}

function okResponse(program: Program): Response {
  return { ok: true, status: 200, json: async () => program } as Response;
}

function notFoundResponse(): Response {
  return {
    ok: false,
    status: 404,
    json: async () => ({ error: "not_found" }),
  } as Response;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createProgramDetailStore", () => {
  it("dedupes concurrent loads of the same slug", async () => {
    const gate = deferred<Response>();
    const fetchDetail = vi.fn(() => gate.promise);
    const store = createProgramDetailStore(fetchDetail);

    const first = store.load(["a", null, undefined, "a"]);
    const second = store.load(["a"]);
    expect(fetchDetail).toHaveBeenCalledTimes(1);

    gate.resolve(okResponse(mkProgram(["CS 115"])));
    await Promise.all([first, second]);
    expect(store.get("a")?.name).toBe("Testing (Bachelor of Testing)");
    expect(fetchDetail).toHaveBeenCalledTimes(1);
  });

  it("records a 404 as settled and never refetches it", async () => {
    const fetchDetail = vi.fn(async () => notFoundResponse());
    const store = createProgramDetailStore(fetchDetail);

    await store.load(["gone"]);
    expect(store.get("gone")).toBeNull();
    expect(store.areLoaded(["gone"])).toBe(true);

    await store.load(["gone"]);
    expect(fetchDetail).toHaveBeenCalledTimes(1);
  });

  it("caches nothing on a rejected fetch so a later load can succeed", async () => {
    const program = mkProgram(["CS 115"]);
    const fetchDetail = vi
      .fn(async () => okResponse(program))
      .mockRejectedValueOnce(new Error("offline"));
    const store = createProgramDetailStore(fetchDetail);

    await expect(store.load(["a"])).resolves.toBeUndefined();
    expect(store.get("a")).toBeNull();
    expect(store.areLoaded(["a"])).toBe(false);
    expect(store.version()).toBe(0);

    await store.load(["a"]);
    expect(fetchDetail).toHaveBeenCalledTimes(2);
    expect(store.get("a")).toBe(program);
    expect(store.areLoaded(["a"])).toBe(true);
  });

  it("prime clears a recorded 404, invalidates memoized codes, and defers the bump", async () => {
    const fetchDetail = vi.fn(async () => notFoundResponse());
    const store = createProgramDetailStore(fetchDetail);
    await store.load(["a"]);
    expect(store.areLoaded(["a"])).toBe(true);

    const listener = vi.fn();
    store.subscribe(listener);
    const versionBefore = store.version();

    store.prime({ a: mkProgram(["CS 115"]) });
    // Reads resolve synchronously; the notification is a microtask away.
    expect(store.get("a")).not.toBeNull();
    expect(listener).not.toHaveBeenCalled();
    expect(store.version()).toBe(versionBefore);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.version()).toBe(versionBefore + 1);

    expect(store.planReferencedCodes(["a"])).toEqual(new Set(["cs 115"]));
    // Re-prime with a different object: the memoized set must not survive.
    store.prime({ a: mkProgram(["CS 136"]) });
    expect(store.planReferencedCodes(["a"])).toEqual(new Set(["cs 136"]));
  });

  it("a prime landing mid-fetch wins over the fetch result", async () => {
    const gate = deferred<Response>();
    const fetchDetail = vi.fn(() => gate.promise);
    const store = createProgramDetailStore(fetchDetail);

    const loading = store.load(["a"]);
    const primed = mkProgram(["CS 115"]);
    store.prime({ a: primed });
    await Promise.resolve();
    const versionAfterPrime = store.version();

    gate.resolve(okResponse(mkProgram(["STALE 999"])));
    await loading;
    expect(store.get("a")).toBe(primed);
    // The discarded fetch result must not notify either.
    expect(store.version()).toBe(versionAfterPrime);
  });

  it("planReferencedCodes unions programs with their own specializations", async () => {
    const store = createProgramDetailStore(vi.fn());
    store.prime({
      p1: mkProgram(["CS 115"], ["CS 499"]),
      p2: mkProgram(["MATH 135"], ["SYDE 411"]),
    });

    expect(store.planReferencedCodes(["p1", "p2"], { p2: "spec" })).toEqual(
      new Set(["cs 115", "math 135", "syde 411"]),
    );
    expect(store.planReferencedCodes(["p1", "p2"])).toEqual(
      new Set(["cs 115", "math 135"]),
    );
  });
});
