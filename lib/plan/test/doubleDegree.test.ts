import { describe, expect, it } from "vitest";
import { getSpecialization, PROGRAMS } from "@/lib/programsRegistry";
import {
  doubleDegreeSuggestionMessage,
  specsAfterDoubleDegreeSwap,
  suggestedDoubleDegree,
  swapToDoubleDegree,
} from "../doubleDegree";

// The three reachable pairs: [standalone SDS, standalone BSW, packaged plan id].
const SDS_BSW_PAIRS: Array<[string, string, string]> = [
  [
    "h-social-development-studies",
    "social-work",
    "h-ba-sds-and-h-bsw-double-degree",
  ],
  [
    "3g-social-development-studies",
    "social-work",
    "3g-ba-sds-and-h-bsw-double-degree",
  ],
  [
    "4g-social-development-studies",
    "social-work",
    "4g-ba-sds-and-h-bsw-double-degree",
  ],
];

describe("suggestedDoubleDegree", () => {
  it("resolves each known SDS/BSW pair to its packaged plan", () => {
    for (const [a, b, ddId] of SDS_BSW_PAIRS) {
      expect(suggestedDoubleDegree([a, b])?.id).toBe(ddId);
    }
  });

  it("is order-insensitive", () => {
    for (const [a, b, ddId] of SDS_BSW_PAIRS) {
      expect(suggestedDoubleDegree([b, a])?.id).toBe(ddId);
    }
  });

  it("returns the packaged Program object alongside its id", () => {
    const s = suggestedDoubleDegree([
      "h-social-development-studies",
      "social-work",
    ]);
    expect(s?.program).toBe(PROGRAMS["h-ba-sds-and-h-bsw-double-degree"]);
  });

  it("returns null for unmapped, single, 3+, unknown, and empty selections", () => {
    // Two real programs, but no packaged plan for the combo.
    expect(
      suggestedDoubleDegree([
        "h-social-development-studies",
        "h-computer-science-bcs",
      ]),
    ).toBeNull();
    expect(suggestedDoubleDegree(["h-social-development-studies"])).toBeNull();
    expect(
      suggestedDoubleDegree([
        "h-social-development-studies",
        "social-work",
        "h-computer-science-bcs",
      ]),
    ).toBeNull();
    expect(
      suggestedDoubleDegree(["not-a-real-program", "social-work"]),
    ).toBeNull();
    expect(suggestedDoubleDegree([])).toBeNull();
  });
});

describe("doubleDegreeSuggestionMessage", () => {
  it("names the packaged plan's short name", () => {
    const msg = doubleDegreeSuggestionMessage(
      PROGRAMS["h-ba-sds-and-h-bsw-double-degree"],
    );
    expect(msg).toContain(
      "Social Development Studies and Social Work Double Degree",
    );
  });
});

describe("swapToDoubleDegree", () => {
  const DD = "h-ba-sds-and-h-bsw-double-degree";
  const pair = ["h-social-development-studies", "social-work"];

  it("collapses the two standalone ids to the single packaged id", () => {
    expect(swapToDoubleDegree(pair, {}, DD).programIds).toEqual([DD]);
  });

  it("carries over a specialization the packaged plan offers", () => {
    const { specializationIds } = swapToDoubleDegree(
      pair,
      { "h-social-development-studies": "sds-education" },
      DD,
    );
    expect(specializationIds).toEqual({ [DD]: "sds-education" });
  });

  it("drops a specialization the packaged plan does not offer", () => {
    // The standalone SDS offers `sds-social-work`; the double degree does not.
    expect(getSpecialization(DD, "sds-social-work")).toBeNull();
    const { specializationIds } = swapToDoubleDegree(
      pair,
      { "h-social-development-studies": "sds-social-work" },
      DD,
    );
    expect(specializationIds).toEqual({});
  });
});

describe("specsAfterDoubleDegreeSwap", () => {
  const DD = "h-ba-sds-and-h-bsw-double-degree";
  const detected = ["h-social-development-studies", "social-work"];

  it("re-keys a detected spec the packaged plan offers when the pair is swapped", () => {
    expect(
      specsAfterDoubleDegreeSwap(
        detected,
        { "h-social-development-studies": "sds-education" },
        [DD],
      ),
    ).toEqual({ [DD]: "sds-education" });
  });

  it("drops a detected spec the packaged plan does not offer on swap", () => {
    expect(
      specsAfterDoubleDegreeSwap(
        detected,
        { "h-social-development-studies": "sds-social-work" },
        [DD],
      ),
    ).toEqual({});
  });

  it("leaves specs untouched when the selection is not the swapped double degree", () => {
    const specs = { "h-social-development-studies": "sds-education" };
    // Still the two standalones (no swap yet).
    expect(specsAfterDoubleDegreeSwap(detected, specs, detected)).toBe(specs);
    // An unrelated single-program selection.
    expect(
      specsAfterDoubleDegreeSwap(detected, specs, ["h-computer-science-bcs"]),
    ).toBe(specs);
  });
});

// The mapping is hand-authored against data/programs.json — a future rename of
// any constituent or target program should fail here loudly, not silently stop
// suggesting. (AGENTS.md: verify academic-data rules against the source.)
describe("double-degree mapping integrity", () => {
  it("every constituent and target id exists, and each target is a double degree", () => {
    for (const [a, b, ddId] of SDS_BSW_PAIRS) {
      expect(PROGRAMS[a]).toBeDefined();
      expect(PROGRAMS[b]).toBeDefined();
      expect(PROGRAMS[ddId]).toBeDefined();
      expect(PROGRAMS[ddId].name).toMatch(/Double Degree/i);
    }
  });
});
