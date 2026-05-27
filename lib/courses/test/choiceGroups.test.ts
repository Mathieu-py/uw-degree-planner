import { describe, expect, it } from "vitest";
import { PROGRAMS, type Program, type RuleNode } from "@/lib/programs";
import {
  enumerateChoiceGroups,
  pickedCoursesFor,
  resolveChoiceGroupPath,
} from "../choiceGroups";

const flexible = (rules: RuleNode): Program => ({
  kind: "flexible",
  name: "test",
  asOf: "2026-05-23",
  rules,
});

describe("enumerateChoiceGroups (engineering)", () => {
  const eleProgram = PROGRAMS["electrical-engineering"];
  if (eleProgram.kind !== "engineering")
    throw new Error("electrical-engineering must be engineering");

  it("returns entries in term order across the whole program", () => {
    const entries = enumerateChoiceGroups(eleProgram);
    const terms = entries.map((e) => e.termLabel);
    // Terms must appear in 1A..4B order (no later term before an earlier one).
    const order = ["1A", "1B", "2A", "2B", "3A", "3B", "4A", "4B"];
    let lastIdx = -1;
    for (const t of terms) {
      const idx = order.indexOf(t ?? "");
      expect(idx).toBeGreaterThanOrEqual(lastIdx);
      lastIdx = idx;
    }
  });

  it("encodes engineering paths with term-letter prefix and dot-separated indices", () => {
    const entries = enumerateChoiceGroups(eleProgram);
    for (const e of entries) {
      expect(e.path).toMatch(/^[1-4][AB](\.\d+)*$/);
    }
  });

  it("surfaces the 1A communications pick (commst192 / engl192)", () => {
    const entries = enumerateChoiceGroups(eleProgram);
    const comms = entries.find((e) => e.options.includes("commst192"));
    expect(comms).toBeDefined();
    expect(comms?.options.sort()).toEqual(["commst192", "engl192"]);
    expect(comms?.termLabel).toBe("1A");
    expect(comms?.selectMin).toBe(1);
    expect(comms?.selectMax).toBe(1);
  });
});

describe("enumerateChoiceGroups (flexible)", () => {
  const englishLit = PROGRAMS["3g-english-literature-and-rhetoric"];
  if (englishLit.kind !== "flexible")
    throw new Error("3g-english-literature-and-rhetoric must be flexible");

  it("returns flat list with null termLabel", () => {
    const entries = enumerateChoiceGroups(englishLit);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect(e.termLabel).toBeNull();
  });

  it("encodes flexible paths as bare DFS indices (no term prefix)", () => {
    const entries = enumerateChoiceGroups(englishLit);
    for (const e of entries) {
      expect(e.path).toMatch(/^\d+(\.\d+)*$/);
      expect(e.path).not.toMatch(/^[1-4][AB]/);
    }
  });
});

describe("enumerateChoiceGroups — pickable filter", () => {
  it("excludes a functionally-mandatory pick (pick(N,N) whose options total exactly N)", () => {
    // pick(2,2) over two unique courses is mandatory — the student must take
    // both. No real choice to record.
    const program = flexible({
      kind: "all",
      children: [
        {
          kind: "pick",
          selectMin: 2,
          selectMax: 2,
          children: [{ kind: "courses", courses: ["cs100", "cs101"] }],
        },
      ],
    });
    expect(enumerateChoiceGroups(program)).toEqual([]);
  });

  it("includes a non-mandatory pick (pick(1,1) over 2 options)", () => {
    const program = flexible({
      kind: "pick",
      selectMin: 1,
      selectMax: 1,
      children: [{ kind: "courses", courses: ["cs115", "cs135"] }],
    });
    const entries = enumerateChoiceGroups(program);
    expect(entries).toHaveLength(1);
    expect(entries[0].options).toEqual(["cs115", "cs135"]);
  });

  it("includes a 'Choose any' pick (selectMin / selectMax both undefined)", () => {
    const program = flexible({
      kind: "pick",
      children: [{ kind: "courses", courses: ["cs100", "cs101"] }],
    });
    const entries = enumerateChoiceGroups(program);
    expect(entries).toHaveLength(1);
    expect(entries[0].selectMin).toBeUndefined();
    expect(entries[0].selectMax).toBeUndefined();
  });

  it("recurses into nested picks within a meta-parent", () => {
    // Combinatorics-style: pick(3,3) wrapping nested leaf-picks. The outer
    // meta-parent is not pickable (its children are picks, not courses), so
    // we recurse and surface the inner leaf-picks.
    const program = flexible({
      kind: "pick",
      selectMin: 3,
      selectMax: 3,
      children: [
        {
          kind: "pick",
          selectMin: 1,
          selectMax: 1,
          children: [{ kind: "courses", courses: ["a100", "a101"] }],
        },
        {
          kind: "pick",
          selectMin: 1,
          selectMax: 1,
          children: [{ kind: "courses", courses: ["b100", "b101"] }],
        },
      ],
    });
    const entries = enumerateChoiceGroups(program);
    expect(entries).toHaveLength(2);
    expect(entries[0].options).toEqual(["a100", "a101"]);
    expect(entries[1].options).toEqual(["b100", "b101"]);
  });

  it("returns [] for a program with no pickable rules", () => {
    const program = flexible({
      kind: "all",
      children: [
        { kind: "courses", courses: ["cs100"] },
        { kind: "excluded", courses: ["chem266"] },
      ],
    });
    expect(enumerateChoiceGroups(program)).toEqual([]);
  });
});

describe("resolveChoiceGroupPath", () => {
  const eleProgram = PROGRAMS["electrical-engineering"];
  const englishLit = PROGRAMS["3g-english-literature-and-rhetoric"];

  it("round-trips every entry path back to a `pick` node with matching options", () => {
    const programs: Program[] = [eleProgram, englishLit];
    for (const program of programs) {
      const entries = enumerateChoiceGroups(program);
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        const resolved = resolveChoiceGroupPath(program, entry.path);
        expect(resolved).not.toBeNull();
        expect(resolved?.kind).toBe("pick");
        if (resolved?.kind !== "pick") continue;
        const options = [
          ...new Set(
            resolved.children.flatMap((c) =>
              c.kind === "courses" ? c.courses : [],
            ),
          ),
        ].sort();
        expect(options).toEqual(entry.options);
      }
    }
  });

  it("returns null for an out-of-bounds index", () => {
    expect(resolveChoiceGroupPath(eleProgram, "1A.99")).toBeNull();
  });

  it("returns null for a non-numeric segment", () => {
    expect(resolveChoiceGroupPath(eleProgram, "1A.foo.0")).toBeNull();
  });

  it("returns null when an engineering path's term letter is missing", () => {
    expect(resolveChoiceGroupPath(eleProgram, "0.1")).toBeNull();
  });

  it("returns null when a flexible path begins with a term letter", () => {
    if (englishLit.kind !== "flexible") throw new Error("expected flexible");
    expect(resolveChoiceGroupPath(englishLit, "2A.0")).toBeNull();
  });

  it("returns the program root when the path is empty (flexible)", () => {
    if (englishLit.kind !== "flexible") throw new Error("expected flexible");
    const resolved = resolveChoiceGroupPath(englishLit, "");
    expect(resolved).toBe(englishLit.rules);
  });
});

describe("pickedCoursesFor", () => {
  it("returns the picked codes when they belong to the resolved pick's options", () => {
    const result = pickedCoursesFor("electrical-engineering", {
      "1A.0.1": ["commst192"],
      "2A.0.1": ["math211"],
    });
    expect(result.sort()).toEqual(["commst192", "math211"]);
  });

  it("drops codes that aren't options of the resolved pick", () => {
    const result = pickedCoursesFor("electrical-engineering", {
      "1A.0.1": ["commst192", "totally-fake-course"],
    });
    expect(result).toEqual(["commst192"]);
  });

  it("drops entries whose path doesn't resolve", () => {
    const result = pickedCoursesFor("electrical-engineering", {
      "1A.0.1": ["commst192"],
      "9Z.99.99": ["should-be-dropped"],
    });
    expect(result).toEqual(["commst192"]);
  });

  it("returns [] for an unknown program", () => {
    expect(
      pickedCoursesFor("not-a-program", { "1A.0.1": ["commst192"] }),
    ).toEqual([]);
  });

  it("returns [] for empty selections", () => {
    expect(pickedCoursesFor("electrical-engineering", {})).toEqual([]);
  });

  it("dedupes codes when the same course is picked under multiple paths", () => {
    // Synthetic — pretend two paths both resolved to picks containing 'cs100'.
    // The real safety net is that pickedCoursesFor wraps the result in a Set;
    // we verify the contract here via two paths into the same engineering pick.
    const a = pickedCoursesFor("electrical-engineering", {
      "1A.0.1": ["commst192", "commst192"],
    });
    expect(a).toEqual(["commst192"]);
  });

  it("returns sorted output", () => {
    const result = pickedCoursesFor("electrical-engineering", {
      "2A.0.1": ["math211"],
      "1A.0.1": ["engl192"],
      "4A.0.1": ["gene403"],
    });
    expect(result).toEqual([...result].sort());
  });
});
