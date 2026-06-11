import { describe, expect, it } from "vitest";
import {
  buildEquivalenceFromCourses,
  buildEquivalenceIndex,
  EMPTY_EQUIVALENCE,
  equivalenceForCatalog,
} from "../equivalence";

describe("buildEquivalenceIndex", () => {
  it("groups a cross-listed pair into one class, both directions", () => {
    const idx = buildEquivalenceIndex([["amath242", "cs371"]]);
    expect(idx.areEquivalent("amath242", "cs371")).toBe(true);
    expect(idx.areEquivalent("cs371", "amath242")).toBe(true);
    expect([...idx.classOf("amath242")]).toEqual(["amath242", "cs371"]);
    expect([...idx.classOf("cs371")]).toEqual(["amath242", "cs371"]);
  });

  it("takes the symmetric, transitive closure across linked pairs", () => {
    // a↔b and b↔c ⇒ {a,b,c} all equivalent, even though a and c never paired.
    const idx = buildEquivalenceIndex([
      ["b", "a"],
      ["b", "c"],
    ]);
    expect(idx.areEquivalent("a", "c")).toBe(true);
    expect([...idx.classOf("a")]).toEqual(["a", "b", "c"]);
  });

  it("groups transitively across a third linked pair, sorted", () => {
    // Order-independence: regardless of union order, classOf returns sorted.
    const idx = buildEquivalenceIndex([
      ["cs371", "amath242"],
      ["zz999", "amath242"],
    ]);
    expect([...idx.classOf("zz999")]).toEqual(["amath242", "cs371", "zz999"]);
  });

  it("treats an unknown code as a singleton", () => {
    const idx = buildEquivalenceIndex([["a", "b"]]);
    expect([...idx.classOf("solo")]).toEqual(["solo"]);
    expect(idx.areEquivalent("solo", "a")).toBe(false);
    expect(idx.areEquivalent("solo", "solo")).toBe(true);
  });

  it("expands a set to include every member's equivalents", () => {
    const idx = buildEquivalenceIndex([["amath242", "cs371"]]);
    const expanded = idx.expand(["cs371", "math135"]);
    expect(expanded).toEqual(new Set(["cs371", "amath242", "math135"]));
  });

  it("ignores self-pairs and empty codes", () => {
    const idx = buildEquivalenceIndex([
      ["a", "a"],
      ["", "b"],
    ]);
    expect([...idx.classOf("a")]).toEqual(["a"]);
    expect([...idx.classOf("b")]).toEqual(["b"]);
  });
});

describe("buildEquivalenceFromCourses", () => {
  it("derives links from each course's crossListed field", () => {
    const idx = buildEquivalenceFromCourses([
      { code: "amath242", crossListed: ["cs371"] },
      { code: "cs371", crossListed: ["amath242"] },
      { code: "math135" },
    ]);
    expect(idx.areEquivalent("amath242", "cs371")).toBe(true);
    expect([...idx.classOf("math135")]).toEqual(["math135"]);
  });

  it("works even when only one side declares the link (directional data)", () => {
    const idx = buildEquivalenceFromCourses([
      { code: "amath242", crossListed: ["cs371"] },
      { code: "cs371" }, // twin doesn't reciprocate
    ]);
    expect(idx.areEquivalent("cs371", "amath242")).toBe(true);
  });
});

describe("EMPTY_EQUIVALENCE", () => {
  it("treats every distinct code as its own singleton", () => {
    expect(EMPTY_EQUIVALENCE.areEquivalent("a", "b")).toBe(false);
    expect([...EMPTY_EQUIVALENCE.classOf("a")]).toEqual(["a"]);
    expect(EMPTY_EQUIVALENCE.expand(["a", "b"])).toEqual(new Set(["a", "b"]));
  });
});

describe("equivalenceForCatalog", () => {
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
    const idx = equivalenceForCatalog([
      { code: "amath242", crossListed: ["cs371"] },
    ]);
    expect(idx.areEquivalent("AMATH242", "cs371")).toBe(false);
  });
});
