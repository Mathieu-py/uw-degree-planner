import { describe, expect, it } from "vitest";
import type { ProgramIdentity } from "@/lib/programs";
import { matchProgram, parseProgramClause } from "../program";

// Hand-built identities so the tests don't depend on registry wording.
const SYDE: ProgramIdentity = {
  programId: "systems-design-engineering",
  names: ["systems design engineering", "syde"],
  faculty: "engineering",
};
const CS: ProgramIdentity = {
  programId: "h-computer-science-bcs",
  names: ["computer science", "cs"],
  faculty: "mathematics",
};
const ANTHRO: ProgramIdentity = {
  programId: "3g-anthropology",
  names: ["anthropology"],
  faculty: "arts",
};
// A program whose degree type we couldn't map to a faculty (faculty === null).
const MED_SCI: ProgramIdentity = {
  programId: "medical-sciences",
  names: ["medical sciences"],
  faculty: null,
};

describe("parseProgramClause", () => {
  it("extracts a single allowed program from '<X> students only'", () => {
    expect(parseProgramClause("Anthropology students only")).toEqual({
      allow: ["anthropology"],
      exclude: [],
    });
  });

  it("splits an 'or' list and strips an Honours modifier", () => {
    expect(
      parseProgramClause(
        "Honours Mathematics or Software Engineering students only",
      ),
    ).toEqual({ allow: ["mathematics", "software engineering"], exclude: [] });
  });

  it("reads 'Open only to students in <X>'", () => {
    expect(parseProgramClause("Open only to students in Engineering")).toEqual({
      allow: ["engineering"],
      exclude: [],
    });
  });

  it("separates an excluding carve-out", () => {
    const parsed = parseProgramClause(
      "Open only to students in Engineering excluding students in Software Eng",
    );
    expect(parsed.allow).toEqual(["engineering"]);
    expect(parsed.exclude).toEqual(["software engineering"]);
  });

  it("normalizes '&' to 'and' so ampersand spellings still match", () => {
    // UWFlow writes "Accounting & Financial Management"; the registry uses
    // "… and …". Without normalization this fell through to "check".
    expect(
      parseProgramClause(
        "Accounting & Financial Management or Computing & Financial Management students only",
      ),
    ).toEqual({
      allow: [
        "accounting and financial management",
        "computing and financial management",
      ],
      exclude: [],
    });
  });

  it("reads the bare '… students' form (no 'only')", () => {
    // UWFlow's dominant AFM/ACTSC phrasing omits "only".
    expect(
      parseProgramClause("Accounting and Financial Management students"),
    ).toEqual({ allow: ["accounting and financial management"], exclude: [] });
    expect(
      parseProgramClause(
        "Accounting and Financial Management, Biotechnology students.",
      ),
    ).toEqual({
      allow: ["accounting and financial management", "biotechnology"],
      exclude: [],
    });
  });

  it("peels an inline level / year prefix off the program list", () => {
    expect(
      parseProgramClause(
        "Level 2A or 3A Accounting and Financial Management students",
      ),
    ).toEqual({ allow: ["accounting and financial management"], exclude: [] });
    expect(
      parseProgramClause(
        "First-year Accounting and Financial Management students",
      ),
    ).toEqual({ allow: ["accounting and financial management"], exclude: [] });
  });

  it("reads a bare level + program with no 'students' word", () => {
    // The dominant engineering cohort-lock form, e.g. CIVE125's "1A Civil
    // Engineering" — a level prefix and a program, no "students".
    expect(parseProgramClause("1A Civil Engineering")).toEqual({
      allow: ["civil engineering"],
      exclude: [],
    });
    expect(parseProgramClause("Level 1A Biomedical Engineering")).toEqual({
      allow: ["biomedical engineering"],
      exclude: [],
    });
  });

  it("returns empty lists for prose with no restriction shape", () => {
    expect(parseProgramClause("Recommendation of the department")).toEqual({
      allow: [],
      exclude: [],
    });
  });
});

describe("matchProgram", () => {
  it("allows a student named in the clause", () => {
    expect(
      matchProgram(parseProgramClause("Anthropology students only"), ANTHRO),
    ).toBe("allow");
  });

  it("blocks a recognized student absent from the allowed list", () => {
    // Every allowed program is recognized and SYDE matches none → confident block.
    expect(
      matchProgram(
        parseProgramClause(
          "Honours Mathematics or Software Engineering students only",
        ),
        SYDE,
      ),
    ).toBe("block");
  });

  it("allows via faculty when the clause names the student's faculty", () => {
    expect(
      matchProgram(
        parseProgramClause("Open only to students in Engineering"),
        SYDE,
      ),
    ).toBe("allow");
  });

  it("allows a math-faculty student under 'Mathematics students only'", () => {
    // "Mathematics" is read as the faculty; CS sits in the Math faculty.
    expect(
      matchProgram(parseProgramClause("Mathematics students only"), CS),
    ).toBe("allow");
  });

  it("blocks an excluded student even if their faculty is allowed", () => {
    expect(
      matchProgram(
        parseProgramClause(
          "Open only to students in Engineering excluding students in Systems Design Eng",
        ),
        SYDE,
      ),
    ).toBe("block");
  });

  it("stays unknown when no identity is supplied", () => {
    expect(
      matchProgram(parseProgramClause("Anthropology students only"), null),
    ).toBe("unknown");
  });

  it("stays unknown when the only allowed token is unrecognized prose", () => {
    // Nothing recognizable to anchor on → could be universal prose, so we
    // don't block (keeps the amber "check").
    expect(
      matchProgram(
        parseProgramClause("Underwater Basket Weaving students only"),
        SYDE,
      ),
    ).toBe("unknown");
  });

  it("blocks a non-matching student when the list has at least one known program", () => {
    // SYDE matches neither, and "Actuarial Science" is a recognized program, so
    // the unknown abbreviation doesn't keep this stuck on "check".
    expect(
      matchProgram(
        parseProgramClause("Actuarial Science, Math/FARM students only"),
        SYDE,
      ),
    ).toBe("block");
  });

  it("stays unknown for a faculty clause when the student's faculty is unknown", () => {
    // A Medical Sciences student is really in Science, but our degree-type
    // mapping left faculty null. We can't confirm they're NOT in Science, so
    // we must not block — keep the amber "check" rather than hiding the course.
    expect(
      matchProgram(parseProgramClause("Science students only"), MED_SCI),
    ).toBe("unknown");
    expect(
      matchProgram(
        parseProgramClause("Open only to students in Science"),
        MED_SCI,
      ),
    ).toBe("unknown");
  });

  it("still blocks a null-faculty student on a program-named (non-faculty) clause", () => {
    // No faculty token involved, so the null faculty is irrelevant: the clause
    // names a recognized program the student isn't in → confident block.
    expect(
      matchProgram(parseProgramClause("Anthropology students only"), MED_SCI),
    ).toBe("block");
  });

  it("allows an engineering student despite an unrecognized exclusion token", () => {
    // SYDE is in Engineering and is not the (imaginary) excluded program.
    expect(
      matchProgram(
        parseProgramClause(
          "Open only to students in Engineering excluding students in Imaginary Program",
        ),
        SYDE,
      ),
    ).toBe("allow");
  });
});
