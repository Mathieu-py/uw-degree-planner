import { describe, expect, it } from "vitest";
import { EMPTY_EQUIVALENCE, equivalenceForCatalog } from "../equivalence";

// Build an index from a catalog of {code, crossListed} — the public seam the
// app uses. Each call gets a fresh array, so the identity-memoization is a no-op.
const idxOf = (courses: Array<{ code: string; crossListed?: string[] }>) =>
  equivalenceForCatalog(courses);

describe("equivalenceForCatalog — class building", () => {
  it("groups a cross-listed pair into one class, both directions", () => {
    const idx = idxOf([{ code: "amath242", crossListed: ["cs371"] }]);
    expect(idx.areEquivalent("amath242", "cs371")).toBe(true);
    expect(idx.areEquivalent("cs371", "amath242")).toBe(true);
    expect([...idx.classOf("amath242")]).toEqual(["amath242", "cs371"]);
    expect([...idx.classOf("cs371")]).toEqual(["amath242", "cs371"]);
  });

  it("works even when only one side declares the link (directional data)", () => {
    const idx = idxOf([
      { code: "amath242", crossListed: ["cs371"] },
      { code: "cs371" }, // twin doesn't reciprocate
    ]);
    expect(idx.areEquivalent("cs371", "amath242")).toBe(true);
  });

  it("takes the symmetric, transitive closure across separate links", () => {
    // a→b and b→c ⇒ {a,b,c} all equivalent, even though a and c never linked.
    const idx = idxOf([
      { code: "a", crossListed: ["b"] },
      { code: "b", crossListed: ["c"] },
    ]);
    expect(idx.areEquivalent("a", "c")).toBe(true);
    expect([...idx.classOf("a")]).toEqual(["a", "b", "c"]);
  });

  it("returns class members sorted, regardless of link order", () => {
    const idx = idxOf([
      { code: "cs371", crossListed: ["amath242"] },
      { code: "zz999", crossListed: ["amath242"] },
    ]);
    expect([...idx.classOf("zz999")]).toEqual(["amath242", "cs371", "zz999"]);
  });

  it("treats an unknown code as a singleton", () => {
    const idx = idxOf([{ code: "a", crossListed: ["b"] }]);
    expect([...idx.classOf("solo")]).toEqual(["solo"]);
    expect(idx.areEquivalent("solo", "a")).toBe(false);
    expect(idx.areEquivalent("solo", "solo")).toBe(true);
  });

  it("expands a set to include every member's equivalents", () => {
    const idx = idxOf([{ code: "amath242", crossListed: ["cs371"] }]);
    expect(idx.expand(["cs371", "math135"])).toEqual(
      new Set(["cs371", "amath242", "math135"]),
    );
  });

  it("ignores self-links and empty codes", () => {
    const idx = idxOf([
      { code: "a", crossListed: ["a"] },
      { code: "b", crossListed: [""] },
    ]);
    expect([...idx.classOf("a")]).toEqual(["a"]);
    expect([...idx.classOf("b")]).toEqual(["b"]);
  });

  it("leaves a course with no crossListed as a singleton", () => {
    const idx = idxOf([
      { code: "amath242", crossListed: ["cs371"] },
      { code: "math135" },
    ]);
    expect([...idx.classOf("math135")]).toEqual(["math135"]);
  });
});

describe("equivalenceForCatalog — entry behavior", () => {
  it("memoizes on the catalog reference (returns the same index)", () => {
    const catalog = [{ code: "amath242", crossListed: ["cs371"] }];
    expect(equivalenceForCatalog(catalog)).toBe(equivalenceForCatalog(catalog));
  });

  it("accepts a code→course Map as well as an array", () => {
    const map = new Map([
      ["amath242", { code: "amath242", crossListed: ["cs371"] }],
    ]);
    expect(equivalenceForCatalog(map).areEquivalent("amath242", "cs371")).toBe(
      true,
    );
  });

  it("assumes lowercase codes — a raw-case code silently misses", () => {
    const idx = idxOf([{ code: "amath242", crossListed: ["cs371"] }]);
    expect(idx.areEquivalent("AMATH242", "cs371")).toBe(false);
  });
});

describe("EMPTY_EQUIVALENCE", () => {
  it("treats every distinct code as its own singleton", () => {
    expect(EMPTY_EQUIVALENCE.areEquivalent("a", "b")).toBe(false);
    expect([...EMPTY_EQUIVALENCE.classOf("a")]).toEqual(["a"]);
    expect(EMPTY_EQUIVALENCE.expand(["a", "b"])).toEqual(new Set(["a", "b"]));
  });
});
