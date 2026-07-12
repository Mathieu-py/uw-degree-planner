import { describe, expect, it } from "vitest";
import { courseLevel, coursePrefix } from "@/lib/courses/code";
import type { Course } from "@/lib/courses/types";
import type { PrereqNode } from "@/lib/prereqs/parse";
import { resolveVariantPlacements } from "../variantPlacement";

const START = 1239; // Fall 2023 — a valid academic start term.

function mk(code: string, prereqAst: PrereqNode | null = null): Course {
  return {
    id: 0,
    code,
    name: code,
    prereqs: null,
    coreqs: null,
    antireqs: null,
    rating: null,
    sections: [],
    prefix: coursePrefix(code),
    level: courseLevel(code),
    hasSeats: false,
    prereqAst,
  };
}

const requires = (code: string): PrereqNode => ({ kind: "course", code });

describe("resolveVariantPlacements", () => {
  it("places engineering-termed picks in their rule's own term", () => {
    const out = resolveVariantPlacements(
      {
        programIds: [],
        startTermId: START,
        stream: "regular",
        selections: [
          { code: "ae123", termLabel: "1B" },
          { code: "commst191", termLabel: "2A" },
        ],
      },
      [],
    );
    expect(out).toContainEqual({ code: "ae123", position: "1B" });
    expect(out).toContainEqual({ code: "commst191", position: "2A" });
  });

  it("places flexible picks in the earliest prereq-eligible term (greedy)", () => {
    const catalog = [
      mk("cs135"),
      mk("cs136", requires("cs135")),
      mk("cs246", requires("cs136")),
    ];
    const out = resolveVariantPlacements(
      {
        programIds: [],
        startTermId: START,
        stream: "regular",
        // Deliberately out of order — the resolver sorts by level so prereqs land first.
        selections: [
          { code: "cs246", termLabel: null },
          { code: "cs135", termLabel: null },
          { code: "cs136", termLabel: null },
        ],
      },
      catalog,
    );
    const pos = Object.fromEntries(out.map((p) => [p.code, p.position]));
    expect(pos).toEqual({ cs135: "1A", cs136: "1B", cs246: "2A" });
  });

  it("dedupes a code that appears twice", () => {
    const out = resolveVariantPlacements(
      {
        programIds: [],
        startTermId: START,
        stream: "regular",
        selections: [
          { code: "cs135", termLabel: null },
          { code: "cs135", termLabel: null },
        ],
      },
      [mk("cs135")],
    );
    expect(out).toEqual([{ code: "cs135", position: "1A" }]);
  });

  it("dedupes across a double degree, keeping the engineering-termed placement", () => {
    // Double degree: the same course is an engineering-termed pick in one program
    // and a flexible pick in the other. The `placed` set must collapse them to a
    // single placement, and the engineering term wins (its term is authoritative).
    const out = resolveVariantPlacements(
      {
        programIds: [],
        startTermId: START,
        stream: "regular",
        selections: [
          { code: "cs251", termLabel: "2A" }, // engineering program's pick
          { code: "cs251", termLabel: null }, // other program's flexible pick
        ],
      },
      [mk("cs251")],
    );
    expect(out).toEqual([{ code: "cs251", position: "2A" }]);
  });

  it("returns nothing for empty selections", () => {
    expect(
      resolveVariantPlacements(
        {
          programIds: [],
          startTermId: START,
          stream: "regular",
          selections: [],
        },
        [],
      ),
    ).toEqual([]);
  });

  it("places an uncatalogued intro pick in the first term", () => {
    // No catalog entry, but the level still comes from the code: a 100-level
    // code floors to 1A (a senior one would floor later — see cs490 below).
    const out = resolveVariantPlacements(
      {
        programIds: [],
        startTermId: START,
        stream: "regular",
        selections: [{ code: "xyz101", termLabel: null }],
      },
      [],
    );
    expect(out).toEqual([{ code: "xyz101", position: "1A" }]);
  });

  it("places a pick whose prereq is an unplaced mandatory course in its level term, not 1A", () => {
    // cs341 needs cs240, a mandatory course a manual plan never places, so cs341
    // is ineligible everywhere. It should land in its level term (3A), not 1A.
    const out = resolveVariantPlacements(
      {
        programIds: [],
        startTermId: START,
        stream: "regular",
        selections: [{ code: "cs341", termLabel: null }],
      },
      [mk("cs341", requires("cs240"))],
    );
    expect(out).toEqual([{ code: "cs341", position: "3A" }]);
  });

  it("floors a prereq-less senior pick at its level term, not 1A", () => {
    // cs490 has no prereqs so it's eligible in every term; the level floor keeps
    // it in 4A rather than drifting to first year (earliest-eligible would say 1A).
    const out = resolveVariantPlacements(
      {
        programIds: [],
        startTermId: START,
        stream: "regular",
        selections: [{ code: "cs490", termLabel: null }],
      },
      [mk("cs490")],
    );
    expect(out).toEqual([{ code: "cs490", position: "4A" }]);
  });
});
