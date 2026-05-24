import { describe, expect, it } from "vitest";
import {
  DEFAULT_PURE_FILTERS,
  DEFAULT_STUDENT_PASSAGE,
  decodePureFilters,
  decodeStudentPassage,
  encodePureFilters,
  encodeStudentPassage,
  mergePureFiltersIntoParams,
  mergeStudentPassageIntoParams,
} from "../filterState";
import type { PureFilters, StudentPassage } from "../types";

function roundTripFilters(state: PureFilters): PureFilters {
  return decodePureFilters(
    new URLSearchParams(encodePureFilters(state).toString()),
  );
}

function roundTripPassage(state: StudentPassage): StudentPassage {
  return decodeStudentPassage(
    new URLSearchParams(encodeStudentPassage(state).toString()),
  );
}

describe("decodePureFilters", () => {
  it("returns the default state for an empty URLSearchParams", () => {
    expect(decodePureFilters(new URLSearchParams())).toEqual(
      DEFAULT_PURE_FILTERS,
    );
  });

  it("returns the default state for an empty record", () => {
    expect(decodePureFilters({})).toEqual(DEFAULT_PURE_FILTERS);
  });

  it("accepts Next.js-style searchParams records", () => {
    const state = decodePureFilters({ exc: "PHIL,ENGL", minU: "0.6" });
    expect(state.excludePrefixes).toEqual(["PHIL", "ENGL"]);
    expect(state.minUseful).toBe(0.6);
  });

  it("normalises prefix casing to upper", () => {
    const state = decodePureFilters(new URLSearchParams("exc=phil,engl"));
    expect(state.excludePrefixes).toEqual(["PHIL", "ENGL"]);
  });

  it("parses levels as integers", () => {
    const state = decodePureFilters(new URLSearchParams("lv=100,200,400"));
    expect(state.levels).toEqual([100, 200, 400]);
  });

  it("rejects non-integer level tokens", () => {
    const state = decodePureFilters(new URLSearchParams("lv=200x,3.5,100"));
    expect(state.levels).toEqual([100]);
  });

  it("drops level values outside the supported {100,200,300,400} buckets", () => {
    const state = decodePureFilters(
      new URLSearchParams("lv=50,100,500,250,400"),
    );
    expect(state.levels).toEqual([100, 400]);
  });

  it("clamps minUseful/minEasy above 1 to 1", () => {
    const state = decodePureFilters(new URLSearchParams("minU=2&minE=99"));
    expect(state.minUseful).toBe(1);
    expect(state.minEasy).toBe(1);
  });

  it("treats negative minUseful/minEasy as unset (null)", () => {
    const state = decodePureFilters(new URLSearchParams("minU=-0.5&minE=-1"));
    expect(state.minUseful).toBeNull();
    expect(state.minEasy).toBeNull();
  });

  it("treats non-finite minUseful/minEasy as unset (null)", () => {
    const state = decodePureFilters(
      new URLSearchParams("minU=NaN&minE=Infinity"),
    );
    expect(state.minUseful).toBeNull();
    expect(state.minEasy).toBeNull();
  });

  it("preserves valid decimal minUseful/minEasy inside (0,1)", () => {
    const state = decodePureFilters(new URLSearchParams("minU=0.42&minE=0.7"));
    expect(state.minUseful).toBe(0.42);
    expect(state.minEasy).toBe(0.7);
  });

  it("dedupes list values", () => {
    const state = decodePureFilters(
      new URLSearchParams("lv=100,100,200&exc=PHIL,PHIL,ENGL"),
    );
    expect(state.levels).toEqual([100, 200]);
    expect(state.excludePrefixes).toEqual(["PHIL", "ENGL"]);
  });

  it("dedupes prefixes after case normalisation", () => {
    const state = decodePureFilters(
      new URLSearchParams("exc=phil,PHIL,Phil,ENGL"),
    );
    expect(state.excludePrefixes).toEqual(["PHIL", "ENGL"]);
  });

  it("decodes booleans from 1, ignores other values", () => {
    expect(
      decodePureFilters(new URLSearchParams("seats=1")).hasSeatsAvailable,
    ).toBe(true);
    expect(
      decodePureFilters(new URLSearchParams("seats=0")).hasSeatsAvailable,
    ).toBe(false);
    expect(
      decodePureFilters(new URLSearchParams("seats=true")).hasSeatsAvailable,
    ).toBe(false);
    expect(
      decodePureFilters(new URLSearchParams("up=1")).hideUnmetPrereqs,
    ).toBe(true);
  });

  it("ignores passage params (prog, term)", () => {
    const decoded = decodePureFilters(
      new URLSearchParams("prog=systems-design-engineering&term=3A&exc=PHIL"),
    );
    expect(decoded).toEqual({
      ...DEFAULT_PURE_FILTERS,
      excludePrefixes: ["PHIL"],
    });
  });
});

describe("decodeStudentPassage", () => {
  it("returns the default state for an empty URLSearchParams", () => {
    expect(decodeStudentPassage(new URLSearchParams())).toEqual(
      DEFAULT_STUDENT_PASSAGE,
    );
  });

  it("accepts a known program id and normalises casing", () => {
    expect(
      decodeStudentPassage(
        new URLSearchParams("prog=systems-design-engineering"),
      ).programId,
    ).toBe("systems-design-engineering");
    expect(
      decodeStudentPassage(
        new URLSearchParams("prog=SYSTEMS-DESIGN-ENGINEERING"),
      ).programId,
    ).toBe("systems-design-engineering");
  });

  it("drops unknown program ids to null", () => {
    expect(
      decodeStudentPassage(new URLSearchParams("prog=phys")).programId,
    ).toBeNull();
    expect(
      decodeStudentPassage(new URLSearchParams("prog=")).programId,
    ).toBeNull();
  });

  it("accepts a valid term letter and normalises casing", () => {
    expect(
      decodeStudentPassage(new URLSearchParams("term=3A")).currentTerm,
    ).toBe("3A");
    expect(
      decodeStudentPassage(new URLSearchParams("term=3a")).currentTerm,
    ).toBe("3A");
  });

  it("drops invalid term values to null", () => {
    expect(
      decodeStudentPassage(new URLSearchParams("term=5A")).currentTerm,
    ).toBeNull();
    expect(
      decodeStudentPassage(new URLSearchParams("term=foo")).currentTerm,
    ).toBeNull();
  });

  it("always returns empty completedCourses (profile data lives in localStorage, not URL)", () => {
    expect(
      decodeStudentPassage(new URLSearchParams("prog=syde&term=3A"))
        .completedCourses,
    ).toEqual([]);
    expect(
      decodeStudentPassage(new URLSearchParams("donePlus=cs115"))
        .completedCourses,
    ).toEqual([]);
    expect(
      decodeStudentPassage(new URLSearchParams("doneMinus=syde101"))
        .completedCourses,
    ).toEqual([]);
  });

  it("ignores pure-filter params (exc, lv, …)", () => {
    expect(
      decodeStudentPassage(new URLSearchParams("exc=PHIL&lv=100&seats=1")),
    ).toEqual(DEFAULT_STUDENT_PASSAGE);
  });

  it("accepts a known specialization id alongside its parent program", () => {
    const decoded = decodeStudentPassage(
      new URLSearchParams(
        "prog=3g-english-literature-and-rhetoric&spec=engl-communication-design",
      ),
    );
    expect(decoded.specializationId).toBe("engl-communication-design");
  });

  it("drops a specialization slug that doesn't belong to the program", () => {
    const decoded = decodeStudentPassage(
      new URLSearchParams(
        "prog=systems-design-engineering&spec=engl-communication-design",
      ),
    );
    expect(decoded.specializationId).toBeNull();
  });

  it("drops an orphan specialization slug with no program set", () => {
    expect(
      decodeStudentPassage(
        new URLSearchParams("spec=engl-communication-design"),
      ).specializationId,
    ).toBeNull();
  });

  it("accepts coop/regular for systemOfStudy and rejects other values", () => {
    expect(
      decodeStudentPassage(new URLSearchParams("sys=coop")).systemOfStudy,
    ).toBe("coop");
    expect(
      decodeStudentPassage(new URLSearchParams("sys=regular")).systemOfStudy,
    ).toBe("regular");
    expect(
      decodeStudentPassage(new URLSearchParams("sys=part-time")).systemOfStudy,
    ).toBeNull();
  });

  it("parses a well-formed cgs JSON object and lowercases course codes", () => {
    const cgs = JSON.stringify({
      "2A.children[3]": ["CS136"],
      "root.children[5]": ["math137", "math147"],
    });
    const decoded = decodeStudentPassage(new URLSearchParams([["cgs", cgs]]));
    expect(decoded.choiceGroupSelections).toEqual({
      "2A.children[3]": ["cs136"],
      "root.children[5]": ["math137", "math147"],
    });
  });

  it("drops malformed cgs values to an empty object", () => {
    expect(
      decodeStudentPassage(new URLSearchParams("cgs=not-json{"))
        .choiceGroupSelections,
    ).toEqual({});
    expect(
      decodeStudentPassage(
        new URLSearchParams([["cgs", JSON.stringify(["a"])]]),
      ).choiceGroupSelections,
    ).toEqual({});
    expect(
      decodeStudentPassage(new URLSearchParams([["cgs", JSON.stringify(null)]]))
        .choiceGroupSelections,
    ).toEqual({});
    expect(
      decodeStudentPassage(
        new URLSearchParams([["cgs", JSON.stringify({ k: "not-an-array" })]]),
      ).choiceGroupSelections,
    ).toEqual({});
  });
});

describe("encodePureFilters", () => {
  it("returns an empty URL string for the default state", () => {
    expect(encodePureFilters(DEFAULT_PURE_FILTERS).toString()).toBe("");
  });

  it("omits fields that match the default", () => {
    const state: PureFilters = {
      ...DEFAULT_PURE_FILTERS,
      hasSeatsAvailable: true,
    };
    expect(encodePureFilters(state).toString()).toBe("seats=1");
  });

  it("encodes prefix arrays joined by commas", () => {
    const state: PureFilters = {
      ...DEFAULT_PURE_FILTERS,
      excludePrefixes: ["PHIL", "ENGL"],
    };
    expect(encodePureFilters(state).get("exc")).toBe("PHIL,ENGL");
  });
});

describe("encodeStudentPassage", () => {
  it("returns an empty URL string for the default state", () => {
    expect(encodeStudentPassage(DEFAULT_STUDENT_PASSAGE).toString()).toBe("");
  });

  it("never emits completedCourses to the URL (profile data lives in localStorage)", () => {
    const state: StudentPassage = {
      ...DEFAULT_STUDENT_PASSAGE,
      programId: "systems-design-engineering",
      currentTerm: "3A",
      completedCourses: ["cs115", "math116", "math117"],
    };
    const params = encodeStudentPassage(state);
    expect(params.has("donePlus")).toBe(false);
    expect(params.has("doneMinus")).toBe(false);
    expect([...params.keys()].sort()).toEqual(["prog", "term"]);
  });

  it("emits spec, sys, and cgs when set; omits at defaults", () => {
    const state: StudentPassage = {
      ...DEFAULT_STUDENT_PASSAGE,
      programId: "3g-english-literature-and-rhetoric",
      specializationId: "engl-communication-design",
      systemOfStudy: "coop",
      choiceGroupSelections: { "root.children[2]": ["cs136"] },
    };
    const params = encodeStudentPassage(state);
    expect(params.get("spec")).toBe("engl-communication-design");
    expect(params.get("sys")).toBe("coop");
    expect(params.get("cgs")).toBe(
      JSON.stringify({ "root.children[2]": ["cs136"] }),
    );
  });

  it("omits cgs when the selections object is empty", () => {
    const params = encodeStudentPassage({
      ...DEFAULT_STUDENT_PASSAGE,
      choiceGroupSelections: {},
    });
    expect(params.has("cgs")).toBe(false);
  });
});

describe("mergePureFiltersIntoParams", () => {
  it("preserves sort/page and passage params when filters change", () => {
    const current = new URLSearchParams(
      "s=easy&d=asc&p=2&prog=systems-design-engineering&term=3A&exc=PHIL",
    );
    const next: PureFilters = {
      ...DEFAULT_PURE_FILTERS,
      excludePrefixes: ["ENGL"],
    };
    const merged = mergePureFiltersIntoParams(current, next);
    expect(merged.get("s")).toBe("easy");
    expect(merged.get("d")).toBe("asc");
    expect(merged.get("p")).toBe("2");
    expect(merged.get("prog")).toBe("systems-design-engineering");
    expect(merged.get("term")).toBe("3A");
    expect(merged.get("exc")).toBe("ENGL");
  });

  it("clears filter keys that fall back to default", () => {
    const current = new URLSearchParams("s=easy&exc=PHIL&minU=0.5&seats=1");
    const merged = mergePureFiltersIntoParams(current, DEFAULT_PURE_FILTERS);
    expect(merged.get("s")).toBe("easy");
    expect(merged.has("exc")).toBe(false);
    expect(merged.has("minU")).toBe(false);
    expect(merged.has("seats")).toBe(false);
  });

  it("does not mutate the input params", () => {
    const current = new URLSearchParams("s=easy&exc=PHIL");
    const before = current.toString();
    mergePureFiltersIntoParams(current, {
      ...DEFAULT_PURE_FILTERS,
      excludePrefixes: ["ENGL"],
    });
    expect(current.toString()).toBe(before);
  });

  it("never touches passage params", () => {
    const current = new URLSearchParams(
      "prog=systems-design-engineering&term=3A",
    );
    const merged = mergePureFiltersIntoParams(current, DEFAULT_PURE_FILTERS);
    expect(merged.get("prog")).toBe("systems-design-engineering");
    expect(merged.get("term")).toBe("3A");
  });
});

describe("mergeStudentPassageIntoParams", () => {
  it("preserves sort/page and pure-filter params when passage changes", () => {
    const current = new URLSearchParams(
      "s=easy&d=asc&p=2&exc=PHIL&prog=systems-design-engineering",
    );
    const next: StudentPassage = {
      ...DEFAULT_STUDENT_PASSAGE,
      programId: null,
      currentTerm: null,
    };
    const merged = mergeStudentPassageIntoParams(current, next);
    expect(merged.get("s")).toBe("easy");
    expect(merged.get("d")).toBe("asc");
    expect(merged.get("p")).toBe("2");
    expect(merged.get("exc")).toBe("PHIL");
    expect(merged.has("prog")).toBe(false);
  });

  it("clears prog and term when they fall back to null", () => {
    const current = new URLSearchParams(
      "prog=systems-design-engineering&term=3A&exc=PHIL",
    );
    const merged = mergeStudentPassageIntoParams(
      current,
      DEFAULT_STUDENT_PASSAGE,
    );
    expect(merged.has("prog")).toBe(false);
    expect(merged.has("term")).toBe(false);
    expect(merged.get("exc")).toBe("PHIL");
  });

  it("does not mutate the input params", () => {
    const current = new URLSearchParams("prog=systems-design-engineering");
    const before = current.toString();
    mergeStudentPassageIntoParams(current, {
      ...DEFAULT_STUDENT_PASSAGE,
      currentTerm: "3A",
    });
    expect(current.toString()).toBe(before);
  });

  it("never touches pure-filter params", () => {
    const current = new URLSearchParams("exc=PHIL&lv=100&seats=1&up=1");
    const merged = mergeStudentPassageIntoParams(current, {
      ...DEFAULT_STUDENT_PASSAGE,
      programId: "systems-design-engineering",
    });
    expect(merged.get("exc")).toBe("PHIL");
    expect(merged.get("lv")).toBe("100");
    expect(merged.get("seats")).toBe("1");
    expect(merged.get("up")).toBe("1");
    expect(merged.get("prog")).toBe("systems-design-engineering");
  });
});

describe("composed mergers", () => {
  it("applying both mergers in sequence preserves sort, page, and each other's slots", () => {
    const start = new URLSearchParams("s=easy&d=asc&p=3");
    const filters: PureFilters = {
      ...DEFAULT_PURE_FILTERS,
      excludePrefixes: ["PHIL"],
      hasSeatsAvailable: true,
    };
    const passage: StudentPassage = {
      ...DEFAULT_STUDENT_PASSAGE,
      programId: "systems-design-engineering",
      currentTerm: "3A",
    };
    const afterFilters = mergePureFiltersIntoParams(start, filters);
    const afterBoth = mergeStudentPassageIntoParams(afterFilters, passage);
    expect(afterBoth.get("s")).toBe("easy");
    expect(afterBoth.get("d")).toBe("asc");
    expect(afterBoth.get("p")).toBe("3");
    expect(afterBoth.get("exc")).toBe("PHIL");
    expect(afterBoth.get("seats")).toBe("1");
    expect(afterBoth.get("prog")).toBe("systems-design-engineering");
    expect(afterBoth.get("term")).toBe("3A");
  });

  it("committing pure filters preserves all passage slots (spec, sys, cgs)", () => {
    const start = new URLSearchParams(
      "prog=3g-english-literature-and-rhetoric&spec=engl-communication-design&sys=coop&cgs=" +
        encodeURIComponent(JSON.stringify({ "root.children[2]": ["cs136"] })),
    );
    const merged = mergePureFiltersIntoParams(start, {
      ...DEFAULT_PURE_FILTERS,
      excludePrefixes: ["PHIL"],
    });
    expect(merged.get("prog")).toBe("3g-english-literature-and-rhetoric");
    expect(merged.get("spec")).toBe("engl-communication-design");
    expect(merged.get("sys")).toBe("coop");
    expect(merged.get("cgs")).toBe(
      JSON.stringify({ "root.children[2]": ["cs136"] }),
    );
  });

  it("committing passage clears all five passage slots when reset to defaults", () => {
    const start = new URLSearchParams(
      "prog=3g-english-literature-and-rhetoric&term=3A&spec=engl-communication-design&sys=coop&cgs=%7B%7D&exc=PHIL",
    );
    const merged = mergeStudentPassageIntoParams(
      start,
      DEFAULT_STUDENT_PASSAGE,
    );
    expect(merged.has("prog")).toBe(false);
    expect(merged.has("term")).toBe(false);
    expect(merged.has("spec")).toBe(false);
    expect(merged.has("sys")).toBe(false);
    expect(merged.has("cgs")).toBe(false);
    expect(merged.get("exc")).toBe("PHIL");
  });
});

describe("round trip", () => {
  it("preserves the default pure filters", () => {
    expect(roundTripFilters(DEFAULT_PURE_FILTERS)).toEqual(
      DEFAULT_PURE_FILTERS,
    );
  });

  it("preserves the default passage", () => {
    expect(roundTripPassage(DEFAULT_STUDENT_PASSAGE)).toEqual(
      DEFAULT_STUDENT_PASSAGE,
    );
  });

  it("preserves every URL-resident filter field", () => {
    const state: PureFilters = {
      excludePrefixes: ["PHIL", "ENGL", "ARTS"],
      levels: [100, 200, 300],
      hasSeatsAvailable: true,
      hideUnmetPrereqs: true,
      minUseful: 0.6,
      minEasy: 0.3,
    };
    expect(roundTripFilters(state)).toEqual(state);
  });

  it("preserves every URL-resident passage field but drops completedCourses", () => {
    const state: StudentPassage = {
      ...DEFAULT_STUDENT_PASSAGE,
      programId: "systems-design-engineering",
      currentTerm: "3A",
      completedCourses: ["cs115", "math116", "math117"],
    };
    expect(roundTripPassage(state)).toEqual({ ...state, completedCourses: [] });
  });

  it("preserves spec, sys, and cgs through a roundtrip", () => {
    const state: StudentPassage = {
      ...DEFAULT_STUDENT_PASSAGE,
      programId: "3g-english-literature-and-rhetoric",
      specializationId: "engl-communication-design",
      systemOfStudy: "regular",
      choiceGroupSelections: {
        "root.children[2]": ["cs136"],
        "root.children[5]": ["math137"],
      },
    };
    expect(roundTripPassage(state)).toEqual(state);
  });
});
